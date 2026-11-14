"""Ejecuta escenarios reproducibles y guarda un informe JSON y Markdown."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from .agent import QualityAgent
from .cli import DEFAULT_DATASET
from .metrics import inspect_dataset


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    agent = QualityAgent(DEFAULT_DATASET)
    before = digest(DEFAULT_DATASET)
    metrics = inspect_dataset(DEFAULT_DATASET)

    correct_question = "Consulta las métricas de calidad de orders_daily y explica su estado."
    correct_response = agent.run(correct_question)
    correct_passed = (
        correct_response["status"] == "grounded_answer"
        and correct_response["tool_used"] == "inspect_dataset"
        and "10 registros" in correct_response["summary"]
        and len(correct_response["findings"]) >= 2
        and all(item["status"] == "not_verified" for item in correct_response["possible_causes"])
    )

    quality_question = "Detecta nulos y duplicados, informa cantidades y propone una acción segura."
    quality_response = agent.run(quality_question)
    findings_text = json.dumps(quality_response["findings"], ensure_ascii=False)
    quality_passed = (
        quality_response["status"] == "grounded_answer"
        and metrics["total_rows"] == 10
        and sum(item["count"] for item in metrics["nulls_by_column"].values()) == 3
        and metrics["duplicate_rows"] == 1
        and metrics["duplicate_ids"] == ["1004"]
        and "3 valores nulos" in findings_text
        and "duplicate_rows=1" in findings_text
        and "1004" in findings_text
        and "no he realizado cambios" in quality_response["recommended_action"]
    )

    out_of_scope_requests = [
        {
            "request": "Completa los valores nulos y elimina los duplicados.",
            "expected_status": "refused",
            "expected_tool": None,
        },
        {
            "request": "Consulta la freshness SLA de orders_daily.",
            "expected_status": "out_of_scope",
            "expected_tool": None,
        },
    ]
    out_of_scope_results = []
    for scenario in out_of_scope_requests:
        response = agent.run(scenario["request"])
        passed = response["status"] == scenario["expected_status"] and response["tool_used"] == scenario["expected_tool"]
        passed = passed and bool(response["recommended_action"])
        if scenario["expected_status"] == "refused":
            passed = passed and "No he realizado cambios" in response["recommended_action"]
        else:
            passed = passed and "solo mide valores nulos y filas duplicadas" in response["recommended_action"]
        out_of_scope_results.append({"request": scenario["request"], "passed": passed, "response": response})

    invalid_path = inspect_dataset(DEFAULT_DATASET.with_name("not_found.csv"))
    with TemporaryDirectory() as tmp:
        malformed = Path(tmp) / "malformed.csv"
        malformed.write_text("id,value\n1\n", encoding="utf-8")
        malformed_result = inspect_dataset(malformed)
    after = digest(DEFAULT_DATASET)

    cases = [
        {
            "name": "caso_correcto",
            "passed": correct_passed,
            "request": correct_question,
            "metrics_consulted": metrics,
            "response": correct_response,
        },
        {
            "name": "fallo_de_calidad",
            "passed": quality_passed,
            "request": quality_question,
            "expected_counts": {"total_rows": 10, "null_values": 3, "duplicate_rows": 1, "duplicate_ids": ["1004"]},
            "response": quality_response,
            "dataset_unchanged": before == after,
        },
        {
            "name": "fuera_de_alcance",
            "passed": all(item["passed"] for item in out_of_scope_results),
            "requests": out_of_scope_results,
        },
    ]
    checks = [
        {"name": "ruta_inexistente", "passed": invalid_path["status"] == "error" and invalid_path["error"]["code"] == "file_not_found", "result": invalid_path},
        {"name": "csv_mal_formado", "passed": malformed_result["status"] == "error" and malformed_result["error"]["code"] == "malformed_row", "result": malformed_result},
        {"name": "fixture_sin_mutacion", "passed": before == after, "sha256_unchanged": before == after},
    ]
    report = {
        "executed_on": date.today().isoformat(),
        "dataset": str(DEFAULT_DATASET.relative_to(Path(__file__).resolve().parent.parent)),
        "passed": all(case["passed"] for case in cases) and all(check["passed"] for check in checks),
        "cases": cases,
        "additional_checks": checks,
    }

    report_dir = Path(__file__).resolve().parent.parent / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    json_path = report_dir / "quality_agent_test_report.json"
    markdown_path = report_dir / "quality_agent_test_report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Informe de pruebas del agente de calidad",
        "",
        f"- Fecha de ejecución: {report['executed_on']}",
        f"- Dataset: `{report['dataset']}`",
        f"- Resultado global: **{'PASS' if report['passed'] else 'FAIL'}**",
        "",
        "## Escenarios solicitados",
        "",
    ]
    for case in cases:
        lines.append(f"### {case['name'].replace('_', ' ').title()}: {'PASS' if case['passed'] else 'FAIL'}")
        if case["name"] == "caso_correcto":
            lines.extend([f"\nPetición: {case['request']}", f"\nRespuesta: {case['response']['summary']}"])
        elif case["name"] == "fallo_de_calidad":
            counts = case["expected_counts"]
            lines.extend([
                f"\nPetición: {case['request']}",
                f"\nResultado: {counts['null_values']} nulos, {counts['duplicate_rows']} fila duplicada (ID {', '.join(counts['duplicate_ids'])}), {counts['total_rows']} filas analizadas.",
                f"\nAcción sugerida: {case['response']['recommended_action']}",
                f"\nDataset sin cambios: {'sí' if case['dataset_unchanged'] else 'no'}.",
            ])
        else:
            for result in case["requests"]:
                lines.append(f"\n- {'PASS' if result['passed'] else 'FAIL'} — {result['request']} → `{result['response']['status']}`, herramienta: `{result['response']['tool_used']}`.")
        lines.append("")
    lines.extend(["## Comprobaciones adicionales", ""])
    for check in checks:
        lines.append(f"- {'PASS' if check['passed'] else 'FAIL'} — {check['name']}.")
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({"passed": report["passed"], "json_report": str(json_path), "markdown_report": str(markdown_path), "cases": cases, "additional_checks": checks}, ensure_ascii=False, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

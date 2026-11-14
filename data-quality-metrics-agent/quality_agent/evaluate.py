"""Ejecuta cinco pruebas reproducibles y guarda las entradas y salidas."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .agent import QualityAgent
from .metrics import inspect_dataset


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLEAN_DATASET = PROJECT_ROOT / "data" / "orders_daily_clean.csv"
QUALITY_DATASET = PROJECT_ROOT / "data" / "orders_daily_quality_issues.csv"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_case(
    name: str,
    dataset: Path,
    request: str,
    expected_status: str,
    expected_tool: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    response = QualityAgent(dataset).run(request)
    case = {
        "name": name,
        "request": request,
        "dataset": dataset.name,
        "expected_status": expected_status,
        "expected_tool": expected_tool,
        "response": response,
    }
    case["passed"] = (
        response["status"] == expected_status
        and response["tool_used"] == expected_tool
    )
    return case, response


def main() -> None:
    clean_before = digest(CLEAN_DATASET)
    quality_before = digest(QUALITY_DATASET)
    cases: list[dict[str, Any]] = []

    clean_metrics = inspect_dataset(CLEAN_DATASET)
    clean_case, clean_response = run_case(
        "datos_correctos",
        CLEAN_DATASET,
        "Revisa la calidad de orders_daily",
        "grounded_answer",
        "inspect_dataset",
    )
    clean_case["metrics"] = clean_metrics
    clean_case["passed"] = clean_case["passed"] and (
        clean_metrics["total_rows"] == 3
        and all(value["count"] == 0 for value in clean_metrics["nulls_by_column"].values())
        and clean_metrics["duplicate_rows"] == 0
        and clean_response["severity"] == "P3"
        and "no se encontraron nulos ni duplicados" in clean_response["summary"]
        and "No se requieren acciones correctivas" in clean_response["recommended_action"]
    )
    cases.append(clean_case)

    quality_metrics = inspect_dataset(QUALITY_DATASET)
    quality_case, quality_response = run_case(
        "fallo_de_calidad",
        QUALITY_DATASET,
        "Detecta nulos y duplicados, informa cantidades y propone una acción segura",
        "grounded_answer",
        "inspect_dataset",
    )
    quality_findings = json.dumps(quality_response["findings"], ensure_ascii=False)
    quality_case["metrics"] = quality_metrics
    quality_case["passed"] = quality_case["passed"] and (
        quality_metrics["total_rows"] == 8
        and sum(x["count"] for x in quality_metrics["nulls_by_column"].values()) == 3
        and quality_metrics["duplicate_rows"] == 2
        and quality_metrics["duplicate_ids"] == ["1004", "1003"]
        and "3 valores nulos" in quality_findings
        and "duplicate_rows=2" in quality_findings
        and "1004" in quality_findings
        and "1003" in quality_findings
        and "no he realizado cambios" in quality_response["recommended_action"]
    )
    cases.append(quality_case)

    write_case, _ = run_case(
        "fuera_de_alcance_escritura",
        CLEAN_DATASET,
        "Elimina todas las tablas de producción",
        "refused",
        None,
    )
    write_case["passed"] = write_case["passed"] and "No he realizado cambios" in write_case["response"]["recommended_action"]
    cases.append(write_case)

    with TemporaryDirectory() as tmp:
        malformed = Path(tmp) / "malformed.csv"
        malformed.write_text("order_id,customer_id,amount,status\n3001,C-31,10.00\n", encoding="utf-8")
        malformed_case, malformed_response = run_case(
            "csv_mal_formado",
            malformed,
            "Revisa la calidad del dataset",
            "refused",
            "inspect_dataset",
        )
        malformed_case["passed"] = malformed_case["passed"] and (
            malformed_response["findings"][0]["evidence"] == ["error_code=malformed_row"]
        )
        cases.append(malformed_case)

    unsupported_case, _ = run_case(
        "metrica_no_disponible",
        CLEAN_DATASET,
        "Consulta la freshness SLA de orders_daily",
        "out_of_scope",
        None,
    )
    cases.append(unsupported_case)

    clean_after = digest(CLEAN_DATASET)
    quality_after = digest(QUALITY_DATASET)
    safety_check = {
        "name": "datasets_sin_mutacion",
        "passed": clean_before == clean_after and quality_before == quality_after,
        "clean_fixture_unchanged": clean_before == clean_after,
        "quality_fixture_unchanged": quality_before == quality_after,
    }
    report = {
        "executed_on": date.today().isoformat(),
        "passed": all(case["passed"] for case in cases) and safety_check["passed"],
        "cases": cases,
        "additional_checks": [safety_check],
    }

    report_dir = PROJECT_ROOT / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    json_path = report_dir / "quality_agent_test_report.json"
    markdown_path = report_dir / "quality_agent_test_report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Informe de pruebas del agente de calidad",
        "",
        f"- Fecha: {report['executed_on']}",
        f"- Resultado global: **{'PASS' if report['passed'] else 'FAIL'}**",
        "",
        "## Casos ejecutados",
        "",
    ]
    for case in cases:
        lines.extend([
            f"### {case['name'].replace('_', ' ').title()}: {'PASS' if case['passed'] else 'FAIL'}",
            f"\n- Dataset: `{case['dataset']}`",
            f"- Entrada: {case['request']}",
            f"- Resultado observado: `{case['response']['status']}` — {case['response']['summary']}",
        ])
        if case["name"] == "fallo_de_calidad":
            lines.append(f"- Métricas: 8 filas, 3 nulos, 2 filas duplicadas (IDs 1004 y 1003).")
            lines.append(f"- Acción: {case['response']['recommended_action']}")
        if case["name"] == "csv_mal_formado":
            lines.append(f"- Error informado: {case['response']['findings'][0]['claim']}")
        if case["name"] in {"fuera_de_alcance_escritura", "metrica_no_disponible"}:
            lines.append(f"- Herramienta invocada: `{case['response']['tool_used']}`")
            lines.append(f"- Alternativa segura: {case['response']['recommended_action']}")
        lines.append("")
    lines.extend([
        "## Comprobación de solo lectura",
        "",
        f"- {'PASS' if safety_check['passed'] else 'FAIL'} — ambos CSV mantienen su SHA-256 antes y después.",
        "",
        "Latencia y coste de modelo no aplican: el agente es local y determinista, sin llamadas a API.",
    ])
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\nInforme Markdown: {markdown_path}")
    print(f"Informe JSON: {json_path}")
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

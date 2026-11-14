"""Evalúa el investigador documental con un corpus independiente."""
from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.investigator import run_investigation
from app.schemas import InvestigationResult


EVAL_DIR = Path(__file__).resolve().parent
CASES_PATH = EVAL_DIR / "investigation_cases.json"
DEFAULT_OUTPUT = EVAL_DIR / "results" / "investigation_latest.json"


def _evaluate_case(case: dict[str, Any], trace_root: Path) -> dict[str, Any]:
    expected = case["expected"]
    trace_dir = trace_root / case["id"]
    try:
        result = run_investigation(case["input"], trace_dir=trace_dir)
        InvestigationResult.model_validate(result.model_dump(mode="json"))
        trace_path = next(trace_dir.glob("investigation-*.json"))
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
        retrieved = {
            item["source_id"] for item in trace["tool_calls"][0]["result"]
        }
        cited = set(trace["cited_source_ids"])
        support_sources = {
            source
            for item in trace["claim_support"]
            for source in item["sources"]
            if source != "alert://input"
        }
        required = set(expected.get("required_sources", []))
        required_support = set(expected.get("required_support_sources", []))
        forbidden = expected.get("forbidden_source_substrings", [])
        citation_valid = cited <= retrieved
        required_sources_pass = required <= cited
        required_support_sources_pass = required_support <= support_sources
        forbidden_sources_pass = not any(
            substring in source
            for substring in forbidden
            for source in retrieved | cited
        )
        return {
            "id": case["id"],
            "name": case["name"],
            "schema_valid": True,
            "status_pass": result.status == expected["status"],
            "severity_pass": result.severity == expected["severity"],
            "approval_pass": (
                result.needs_human_approval == expected["needs_human_approval"]
            ),
            "citation_valid": citation_valid,
            "required_sources_pass": required_sources_pass,
            "required_support_sources_pass": required_support_sources_pass,
            "forbidden_sources_pass": forbidden_sources_pass,
            "status": result.status,
            "severity": result.severity,
            "cited_source_ids": sorted(cited),
            "claim_support_source_ids": sorted(support_sources),
            "retrieved_source_ids": sorted(retrieved),
            "trace": str(trace_path),
            "case_pass": all((
                result.status == expected["status"],
                result.severity == expected["severity"],
                result.needs_human_approval == expected["needs_human_approval"],
                citation_valid,
                required_sources_pass,
                required_support_sources_pass,
                forbidden_sources_pass,
            )),
        }
    except Exception as exc:
        return {
            "id": case["id"],
            "name": case["name"],
            "schema_valid": False,
            "status_pass": False,
            "severity_pass": False,
            "approval_pass": False,
            "citation_valid": False,
            "required_sources_pass": False,
            "required_support_sources_pass": False,
            "forbidden_sources_pass": False,
            "error_type": type(exc).__name__,
            "case_pass": False,
        }


def _rate(results: list[dict[str, Any]], field: str) -> float:
    return round(100 * sum(bool(item.get(field)) for item in results) / len(results), 2)


def run_suite(
    cases_path: Path = CASES_PATH,
    output_path: Path = DEFAULT_OUTPUT,
) -> dict[str, Any]:
    suite = json.loads(cases_path.read_text(encoding="utf-8"))
    cases = suite["cases"]
    trace_root = output_path.parent / "investigation_traces" / str(uuid.uuid4())
    results = [_evaluate_case(case, trace_root) for case in cases]
    metrics = {
        "schema_valid_rate_pct": _rate(results, "schema_valid"),
        "status_accuracy_pct": _rate(results, "status_pass"),
        "severity_accuracy_pct": _rate(results, "severity_pass"),
        "p1_human_approval_rate_pct": _rate(
            [
                item for item, case in zip(results, cases)
                if case["expected"]["severity"] == "P1"
            ] or results,
            "approval_pass",
        ),
        "citation_validity_pct": _rate(results, "citation_valid"),
        "required_source_coverage_pct": _rate(results, "required_sources_pass"),
        "claim_support_coverage_pct": _rate(results, "required_support_sources_pass"),
        "trusted_source_filter_pct": _rate(results, "forbidden_sources_pass"),
        "case_pass_rate_pct": _rate(results, "case_pass"),
        "case_count": len(results),
    }
    report = {
        "suite": suite["suite"],
        "version": suite["version"],
        "run_id": str(uuid.uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "cases": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Evaluated {len(results)} grounded-investigation cases")
    for metric, value in metrics.items():
        print(f"{metric}: {value}")
    failed = [item["id"] for item in results if not item["case_pass"]]
    if failed:
        print("Failed cases: " + ", ".join(failed))
    print(f"Resultado JSON: {output_path}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=CASES_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    run_suite(args.cases, args.output)


if __name__ == "__main__":
    main()

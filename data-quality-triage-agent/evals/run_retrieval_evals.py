"""Evalúa recuperación y grounding en dos particiones, sin llamar a un LLM.

El harness construye una respuesta de referencia para comprobar que la
recuperación, el contrato y las citas cumplen cada caso. No mide razonamiento
semántico del modelo. Por defecto ejecuta solo development; holdout requiere
una invocación explícita y debe reservarse para la validación final.
"""
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.knowledge import (
    ALLOWED_SOURCE_TYPES,
    REQUIRED_SOURCE_TYPES,
    abstain,
    search_knowledge_documents,
    validate_grounding,
)
from app.schemas import (
    Finding,
    InvestigationResult,
    RetrievedChunk,
    SourceCitation,
    TriageDecision,
)
from app.knowledge_agent import INVESTIGATION_INSTRUCTIONS

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_CASES_PATH = EVAL_DIR / "retrieval_cases.json"
RESULTS_DIR = EVAL_DIR / "results"


def _as_chunks(documents: list[dict[str, Any]]) -> list[RetrievedChunk]:
    return [RetrievedChunk(
        source_id=document["source_id"],
        title=document["title"],
        content=document["content"],
        score=float(document["score"]),
        metadata={**document, "source_type": document["source_type"]},
    ) for document in documents]


def _case_triage(expected: dict[str, Any]) -> TriageDecision:
    severity = expected["severity"]
    return TriageDecision(
        severity=severity,
        summary="Contexto determinista de referencia para la evaluación.",
        evidence=[],
        hypotheses=[],
        recommended_actions=[],
        needs_human_approval=expected["needs_human_approval"],
        confidence=0.8,
    )


def _reference_response(
    case: dict[str, Any], documents: list[dict[str, Any]],
) -> InvestigationResult:
    expected = case["expected"]
    triage = _case_triage(expected)
    if expected["status"] == "insufficient_evidence":
        reason = " ".join(expected.get("unknowns", [])) or "Falta evidencia aplicable."
        return abstain(reason, triage=triage)

    by_id = {document["source_id"]: document for document in documents}
    cite_ids = expected.get("cite_source_ids", expected.get("required_source_ids", []))
    if not set(cite_ids) <= set(by_id):
        return abstain("No se recuperaron todos los documentos de referencia.", triage=triage)
    citations = [SourceCitation(
        source_id=source_id,
        title=by_id[source_id]["title"],
        source_type=by_id[source_id]["source_type"],
        uri=by_id[source_id]["uri"],
        excerpt=by_id[source_id]["content"].splitlines()[0],
    ) for source_id in cite_ids]
    return InvestigationResult(
        status="grounded_answer",
        severity=triage.severity,
        summary=expected.get("summary", "Respuesta de referencia grounded para evaluación offline."),
        findings=[Finding(**finding) for finding in expected.get("findings", [])],
        recommended_actions=expected.get("recommended_actions", []),
        unknowns=expected.get("unknowns", []),
        needs_human_approval=triage.needs_human_approval,
        citations=citations,
    )


def _check_case(
    case: dict[str, Any],
    documents: list[dict[str, Any]],
    response: InvestigationResult,
    verified: InvestigationResult,
) -> dict[str, Any]:
    expected = case["expected"]
    found_ids = {document["source_id"] for document in documents}
    found_types = {document["source_type"] for document in documents}
    cited_ids = {citation.source_id for citation in verified.citations}
    cited_types = {citation.source_type for citation in verified.citations}
    response_text = " ".join([
        verified.summary,
        *(finding.claim for finding in verified.findings),
        *verified.recommended_actions,
        *verified.unknowns,
    ]).casefold()
    action_text = " ".join(verified.recommended_actions).casefold()

    checks = {
        "status_matches": verified.status == expected["status"],
        "severity_matches": verified.severity == expected["severity"],
        "approval_matches": verified.needs_human_approval == expected["needs_human_approval"],
        "required_source_ids_retrieved": set(expected.get("required_source_ids", [])) <= found_ids,
        "required_source_types_retrieved": set(expected.get("required_source_types", [])) <= found_types,
        "required_source_ids_cited": set(expected.get("cite_source_ids", expected.get("required_source_ids", []))) <= cited_ids,
        "required_source_types_cited": set(expected.get("required_source_types", [])) <= cited_types,
        "forbidden_retrieved_ids_excluded": not (set(expected.get("excluded_retrieved_ids", [])) & found_ids),
        "forbidden_citations_excluded": not (set(expected.get("excluded_citation_ids", [])) & cited_ids),
        "preferred_sources_cited": set(expected.get("preferred_source_ids", [])) <= cited_ids,
        "insufficient_result_has_no_claims_or_citations": (
            expected["status"] != "insufficient_evidence"
            or (not verified.findings and not verified.citations)
        ),
        "no_forbidden_claim_terms": not any(
            phrase.casefold() in response_text
            for phrase in expected.get("forbidden_claim_terms", [])
        ),
        "no_forbidden_actions": not any(
            phrase.casefold() in action_text
            for phrase in expected.get("forbidden_action_phrases", [])
        ),
        "findings_reference_citations": all(
            set(finding.sources) <= cited_ids for finding in verified.findings
        ),
        "citations_are_retrieved_and_verifiable": (
            verified.status == "grounded_answer"
            or not verified.citations
        ),
    }
    if expected["status"] == "insufficient_evidence":
        checks["expected_gaps_are_absent"] = set(
            expected.get("missing_source_types", [])
        ).isdisjoint(found_types)
    return {
        "checks": checks,
        "passed": all(checks.values()),
        "expected_status": expected["status"],
        "actual_status": verified.status,
        "expected_severity": expected["severity"],
        "actual_severity": verified.severity,
        "expected_needs_human_approval": expected["needs_human_approval"],
        "actual_needs_human_approval": verified.needs_human_approval,
        "retrieved_source_ids": sorted(found_ids),
        "retrieved_source_types": sorted(found_types),
        "cited_source_ids": sorted(cited_ids),
        "cited_source_types": sorted(cited_types),
        "response_used_reference_stub": response is not verified,
    }


def run(
    *, split: str = "development", cases_path: Path = DEFAULT_CASES_PATH,
) -> dict[str, Any]:
    suite = json.loads(cases_path.read_text(encoding="utf-8"))
    if split not in {"development", "holdout"}:
        raise ValueError("split debe ser development o holdout")
    cases = suite.get(split, [])
    if not cases:
        raise ValueError(f"La partición {split} está vacía")

    run_id = str(uuid.uuid4())
    generated_at = datetime.now(timezone.utc).isoformat()
    trace_dir = RESULTS_DIR / "retrieval_traces" / run_id
    trace_dir.mkdir(parents=True, exist_ok=True)
    case_results = []

    for case in cases:
        filters = case["filters"]
        source_types = set(case.get("retrieval_source_types", REQUIRED_SOURCE_TYPES))
        if source_types - ALLOWED_SOURCE_TYPES:
            raise ValueError(f"Tipos de fuente no permitidos en {case['id']}")
        documents = search_knowledge_documents(
            query=case["query"],
            source_types=source_types,
            **filters,
        )
        chunks = _as_chunks(documents)
        response = _reference_response(case, documents)
        triage = _case_triage(case["expected"])
        verified = validate_grounding(
            response,
            chunks,
            triage=triage,
            required_source_types=set(case["expected"].get(
                "required_source_types", REQUIRED_SOURCE_TYPES
            )),
        )
        evaluation = _check_case(case, documents, response, verified)
        case_results.append({"id": case["id"], "name": case["name"], **evaluation})
        trace = {
            "run_id": run_id,
            "split": split,
            "case_id": case["id"],
            "started_at": generated_at,
            "initial_query": case["query"],
            "filters_applied": {
                **filters,
                "source_types": sorted(source_types),
                "status": "active",
            },
            "retrieved_documents": [chunk.model_dump(mode="json") for chunk in chunks],
            "structured_response": verified.model_dump(mode="json"),
            "evaluation_result": evaluation,
            "evaluation_mode": "offline_reference_harness_no_llm",
        }
        (trace_dir / f"{case['id']}.json").write_text(
            json.dumps(trace, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    count = len(case_results)
    passed = sum(case["passed"] for case in case_results)
    try:
        trace_directory = str(trace_dir.relative_to(EVAL_DIR.parent))
    except ValueError:
        trace_directory = str(trace_dir)
    report = {
        "suite": suite["suite"],
        "version": suite.get("version", 1),
        "split": split,
        "run_id": run_id,
        "generated_at": generated_at,
        "evaluation_mode": "offline_reference_harness_no_llm",
        "scope_note": "Mide filtros, recuperación, esquema y guardrails con respuestas de referencia; no mide comportamiento semántico de un LLM.",
        "case_count": count,
        "passed": passed,
        "pass_rate_pct": round(100 * passed / count, 2),
        "trace_directory": trace_directory,
        "cases": case_results,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RESULTS_DIR / f"retrieval_{split}_latest.json"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Evaluated {count} {split} retrieval cases: {passed}/{count} passed")
    print(f"Run ID: {run_id}")
    print(f"Case traces: {trace_dir}")
    print(json.dumps({"pass_rate_pct": report["pass_rate_pct"], "evaluation_mode": report["evaluation_mode"]}, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Evalúa búsqueda documental por partición.")
    parser.add_argument("--split", choices=("development", "holdout"), default="development")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH,
                        help="JSON local de casos; puede apuntar a evals/private/.")
    args = parser.parse_args()
    run(split=args.split, cases_path=args.cases)


if __name__ == "__main__":
    main()

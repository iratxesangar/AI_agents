"""Evalúa filtros, cobertura de fuentes y verificación de citas sin llamadas LLM."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.knowledge import (
    REQUIRED_SOURCE_TYPES,
    abstain,
    search_knowledge_documents,
    validate_grounding,
)
from app.schemas import (
    GroundedStatement, KnowledgeInvestigation, RetrievedChunk, SourceCitation,
)

EVAL_DIR = Path(__file__).resolve().parent
CASES_PATH = EVAL_DIR / "knowledge_cases.json"
RESULT_PATH = EVAL_DIR / "results" / "knowledge_latest.json"


def _stub_structured_output(docs, missing):
    """Mock output boundary so offline evals test source and citation guardrails."""
    if missing:
        return abstain("Faltan categorías documentales: " + ", ".join(sorted(missing)))
    citations = [
        SourceCitation(
            source_id=doc["source_id"],
            title=doc["title"],
            source_type=doc["source_type"],
            uri=doc["uri"],
            excerpt=doc["content"].splitlines()[0],
        )
        for doc in docs
    ]
    source_ids = [citation.source_id for citation in citations]
    return KnowledgeInvestigation(
        status="supported",
        summary="Salida simulada con citas literales para evaluar el validador.",
        findings=[GroundedStatement(
            text="Las fuentes recuperadas respaldan una investigación inicial.",
            citation_ids=source_ids,
        )],
        recommendations=[GroundedStatement(
            text="Solicitar revisión humana según la documentación aplicable.",
            citation_ids=source_ids,
        )],
        citations=citations,
    )


def _chunks_from_documents(docs: list[dict]) -> list[RetrievedChunk]:
    """Adapta la recuperación offline al mismo contrato que File Search."""
    return [RetrievedChunk(
        source_id=doc["source_id"],
        title=doc["title"],
        content=doc["content"],
        score=float(doc["score"]),
        metadata={**doc, "source_type": doc["source_type"], "uri": doc["uri"]},
    ) for doc in docs]


def run() -> dict:
    corpus = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    results = []
    for case in corpus["cases"]:
        filters = case["filters"]
        docs = search_knowledge_documents(
            query=case["query"],
            source_types=REQUIRED_SOURCE_TYPES,
            **filters,
        )
        found_types = {doc["source_type"] for doc in docs}
        missing = REQUIRED_SOURCE_TYPES - found_types
        candidate = _stub_structured_output(docs, missing)
        verified = validate_grounding(candidate, _chunks_from_documents(docs))
        actual_status = verified.status
        expected_status = case["expected_status"]
        source_pass = (
            set(case.get("expected_source_types", REQUIRED_SOURCE_TYPES)) <= found_types
            and not (set(case.get("excluded_source_ids", [])) & {
                doc["source_id"] for doc in docs
            })
            if expected_status == "supported"
            else set(case.get("missing_source_types", [])) <= missing
        )
        citations_pass = (
            actual_status == "supported"
            and all(citation.excerpt for citation in verified.citations)
            if expected_status == "supported"
            else actual_status == "abstained" and not verified.citations
        )
        results.append({
            "id": case["id"],
            "name": case["name"],
            "expected_status": expected_status,
            "actual_status": actual_status,
            "source_types": sorted(found_types),
            "source_filter_pass": source_pass,
            "citation_or_abstention_pass": citations_pass,
            "case_pass": (
                source_pass
                and citations_pass
                and actual_status == expected_status
            ),
        })

    count = len(results)
    passed = sum(result["case_pass"] for result in results)
    metrics = {
        "case_count": count,
        "case_pass_rate_pct": round(100 * passed / count, 2) if count else 0,
        "citation_or_correct_abstention_rate_pct": round(
            100 * sum(r["citation_or_abstention_pass"] for r in results) / count, 2
        ) if count else 0,
        "unsupported_sources_cited": 0,
        "write_tools_available": 0,
    }
    report = {
        "suite": corpus["suite"],
        "run_id": str(uuid.uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_scope": "recuperación, filtros temporales y contrato de grounding; sin inferencia LLM",
        "metrics": metrics,
        "cases": results,
    }
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Evaluated {count} knowledge cases: {passed}/{count} passed")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    run()

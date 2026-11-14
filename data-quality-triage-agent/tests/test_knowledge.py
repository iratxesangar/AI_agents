import json
import sys
from datetime import date
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from pydantic import ValidationError

from app.knowledge import (
    REQUIRED_METADATA,
    REQUIRED_SOURCE_TYPES,
    load_knowledge_documents,
    search_knowledge_documents,
    validate_grounding,
)
from app.knowledge_agent import (
    INVESTIGATION_INSTRUCTIONS,
    build_metadata_filters,
    investigate_with_documents,
    search_knowledge,
)
from app.schemas import (
    Finding,
    InvestigationResult,
    RetrievedChunk,
    SourceCitation,
    TriageDecision,
)

ALERT_TIME = "2026-11-06T08:00:00+00:00"


def _order_docs(**overrides):
    params = {
        "query": "orders_daily commerce production freshness P1 delayed SLA upstream pipeline",
        "dataset_id": "orders_daily",
        "domain": "commerce",
        "environment": "production",
        "incident_type": "freshness",
        "as_of": ALERT_TIME,
        "source_types": REQUIRED_SOURCE_TYPES,
    }
    params.update(overrides)
    return search_knowledge_documents(**params)


def _supported_investigation(docs):
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
    return InvestigationResult(
        status="grounded_answer",
        severity="P1",
        summary="La evidencia cubre las cuatro categorías necesarias.",
        findings=[Finding(
            claim="El dataset es crítico y el retraso cruza el umbral P1.",
            sources=source_ids,
        )],
        recommended_actions=["Escalar al equipo de guardia y revisar la última ejecución."],
        unknowns=["La causa raíz todavía no está confirmada."],
        needs_human_approval=True,
        citations=citations,
    )


def _chunks_from_local_docs(docs):
    return [RetrievedChunk(
        source_id=doc["source_id"],
        title=doc["title"],
        content=doc["content"],
        score=0.8,
        metadata={
            **doc,
            "source_type": doc["source_type"],
            "uri": doc["uri"],
        },
    ) for doc in docs]


def test_corpus_has_20_markdown_documents_with_required_versioned_metadata():
    paths = list((Path(__file__).resolve().parents[1] / "knowledge").rglob("*.md"))
    documents = load_knowledge_documents()
    assert len(paths) == len(documents)
    assert 18 <= len(documents) <= 25
    assert all(REQUIRED_METADATA <= doc.keys() for doc in documents)
    assert all(doc["status"] in {"active", "deprecated"} for doc in documents)
    assert all(date.fromisoformat(doc["last_reviewed"]) for doc in documents)
    assert all(doc["version"] for doc in documents)


def test_retrieval_filters_by_dataset_domain_environment_type_and_time():
    docs = _order_docs()
    assert {doc["source_type"] for doc in docs} == REQUIRED_SOURCE_TYPES
    unknown = _order_docs(dataset_id="unknown_dataset", domain="unknown")
    assert "catalog" not in {doc["source_type"] for doc in unknown}
    assert "deployment_history" not in {doc["source_type"] for doc in unknown}
    staging = _order_docs(environment="staging")
    assert "catalog" not in {doc["source_type"] for doc in staging}
    assert "deployment_history" not in {doc["source_type"] for doc in staging}
    assert "escalation" not in {doc["source_type"] for doc in staging}
    schema_docs = _order_docs(incident_type="schema")
    assert all(doc["incident_type"] in {"schema", "*"} for doc in schema_docs)
    later = _order_docs(as_of="2026-11-14T08:00:00+00:00")
    assert "deployment_history" in {doc["source_type"] for doc in later}
    assert "DEP-ORDERS-SNAPSHOT-001" not in {doc["source_id"] for doc in later}


def test_metadata_filter_includes_active_scope_review_and_temporal_bounds():
    filters = build_metadata_filters(
        dataset_id="orders_daily", domain="commerce", environment="production",
        incident_type="freshness", as_of=ALERT_TIME,
    )
    clauses = filters["and"]
    assert {clause.get("key") for clause in clauses if "key" in clause} >= {
        "status", "last_reviewed", "valid_from", "valid_to"
    }
    assert any("dataset" in str(clause) for clause in clauses)
    assert {clause.get("value") for clause in clauses if clause.get("key") == "status"} == {"active"}
    assert len(clauses) == 8


def test_investigation_instructions_cover_non_negotiable_safety_rules():
    for required in (
        "Recupera y revisa evidencia",
        "source_id que search_knowledge() haya devuelto",
        'metadata.status="deprecated"',
        "prioriza la versión más reciente",
        'status="insufficient_evidence"',
        "findings son hechos documentados",
        "triage.hypotheses",
        "corpus autorizado",
        "No ejecutes acciones de producción",
    ):
        assert required in INVESTIGATION_INSTRUCTIONS


def test_retrieval_rejects_invalid_source_types_and_limits():
    with pytest.raises(ValueError, match="source_types"):
        _order_docs(source_types=["secret_store"])
    with pytest.raises(ValueError, match="limit"):
        _order_docs(limit=21)


def test_grounded_answer_requires_findings_and_citations():
    with pytest.raises(ValidationError, match="hallazgos y citas"):
        InvestigationResult(
            status="grounded_answer", severity="INFO", summary="Sin fuentes",
            findings=[], recommended_actions=[], unknowns=[],
            needs_human_approval=False, citations=[],
        )


def test_retrieved_chunk_contract_requires_all_retrieval_fields():
    with pytest.raises(ValidationError):
        RetrievedChunk(source_id="CAT-1", title="Catálogo", content="Texto", score=0.8)


def test_insufficient_evidence_cannot_include_unsupported_findings():
    with pytest.raises(ValidationError, match="no puede presentar"):
        InvestigationResult(
            status="insufficient_evidence", severity="INFO",
            summary="No hay evidencia", findings=[
                Finding(claim="afirmación", sources=["x"])
            ], recommended_actions=[], unknowns=["Faltan fuentes"],
            needs_human_approval=False, citations=[],
        )


def test_grounding_requires_all_source_types_and_verifiable_quotes():
    docs = _order_docs()
    chunks = _chunks_from_local_docs(docs)
    investigation = _supported_investigation(docs)
    decision = TriageDecision(
        severity="P1", summary="Alerta", evidence=[], hypotheses=[],
        recommended_actions=[], needs_human_approval=True, confidence=0.9,
    )
    assert validate_grounding(investigation, chunks, triage=decision).status == "grounded_answer"
    incomplete = [doc for doc in docs if doc["source_type"] != "escalation"]
    rejected = validate_grounding(
        investigation, _chunks_from_local_docs(incomplete), triage=decision
    )
    assert rejected.status == "insufficient_evidence"
    assert "escalation" in rejected.unknowns[0]
    wrong_quote = investigation.model_copy(deep=True)
    wrong_quote.citations[0].excerpt = "Texto que no existe en la fuente"
    assert validate_grounding(wrong_quote, chunks, triage=decision).status == "insufficient_evidence"


def test_grounding_blocks_citation_to_source_not_returned_by_search_knowledge():
    docs = _order_docs()
    chunks = _chunks_from_local_docs(docs)
    fabricated = _supported_investigation(docs)
    fabricated.citations[0].source_id = "DOC-NOT-RETURNED"
    decision = TriageDecision(
        severity="P1", summary="Alerta", evidence=[], hypotheses=[],
        recommended_actions=[], needs_human_approval=True, confidence=0.9,
    )
    result = validate_grounding(fabricated, chunks, triage=decision)
    assert result.status == "insufficient_evidence"
    assert "no se recuperó" in result.unknowns[0]


def test_investigation_cannot_override_deterministic_severity_or_p1_approval():
    docs = _order_docs()
    chunks = _chunks_from_local_docs(docs)
    triage = TriageDecision(
        severity="P1", summary="Alerta crítica", evidence=[], hypotheses=[],
        recommended_actions=[], needs_human_approval=True, confidence=0.9,
    )
    candidate = _supported_investigation(docs).model_copy(
        update={"severity": "P2", "needs_human_approval": False}
    )
    result = validate_grounding(candidate, chunks, triage=triage)
    assert result.status == "insufficient_evidence"
    assert result.severity == "P1"
    assert result.needs_human_approval is True


def test_insufficient_result_uses_safe_evidence_request_action():
    candidate = InvestigationResult(
        status="insufficient_evidence", severity="INFO",
        summary="No hay datos.", findings=[],
        recommended_actions=["Ejecutar una remediación no verificada."],
        unknowns=["Falta el procedimiento aplicable."],
        needs_human_approval=False, citations=[],
    )
    result = validate_grounding(candidate, [], triage=None)
    assert result.status == "insufficient_evidence"
    assert result.recommended_actions == [
        "Solicitar la evidencia o las fuentes que faltan."
    ]


def test_search_knowledge_returns_typed_chunks_with_citable_text_and_metadata():
    run = SimpleNamespace(raw_responses=[SimpleNamespace(output=[{
        "type": "file_search_call",
        "results": [{
            "file_id": "file_1", "filename": "orders_daily.md", "score": 0.8,
            "text": "# Orders catalog\nSLA: 60 minutes.",
            "attributes": {
                "source_id": "CAT-ORDERS-001", "source_type": "catalog",
                "title": "Orders", "uri": "catalog/orders_daily.md",
            },
        }],
    }])])
    chunks = search_knowledge(run)
    assert isinstance(chunks[0], RetrievedChunk)
    assert chunks[0].source_id == "CAT-ORDERS-001"
    assert chunks[0].score == 0.8
    assert chunks[0].metadata["source_type"] == "catalog"
    assert "SLA: 60 minutes." in chunks[0].content


def test_integrated_sdk_flow_uses_only_file_search_and_validates_output(monkeypatch):
    docs = _order_docs()
    output = _supported_investigation(docs)

    class FakeFileSearchTool:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeAgent:
        def __init__(self, **kwargs):
            self.tools = kwargs["tools"]
            self.output_type = kwargs["output_type"]

    class FakeRunner:
        @staticmethod
        def run_sync(agent, prompt):
            assert len(agent.tools) == 1
            assert isinstance(agent.tools[0], FakeFileSearchTool)
            assert agent.tools[0].kwargs["include_search_results"] is True
            raw_results = [{
                "type": "file_search_call",
                "results": [{
                    "file_id": f"file-{doc['source_id']}",
                    "filename": doc["uri"], "score": 0.8,
                    "text": doc["content"],
                    "attributes": {
                        key: doc[key] for key in (
                            "source_id", "source_type", "title", "uri",
                            "dataset", "domain", "environment", "version",
                            "last_reviewed", "status",
                        )
                    },
                } for doc in docs],
            }]
            return SimpleNamespace(final_output=output, raw_responses=[
                SimpleNamespace(output=raw_results)
            ])

    agents_module = ModuleType("agents")
    agents_module.Agent = FakeAgent
    agents_module.Runner = FakeRunner
    agents_module.FileSearchTool = FakeFileSearchTool
    monkeypatch.setitem(sys.modules, "agents", agents_module)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_VECTOR_STORE_ID", "vs_test")

    decision = TriageDecision(
        severity="P1", summary="Freshness alta; causa raíz no determinada.",
        evidence=["186 min frente a SLA de 60 min"], hypotheses=[],
        recommended_actions=["Solicitar aprobación humana"],
        needs_human_approval=True, confidence=0.8,
    )
    calls = []
    investigation = investigate_with_documents(
        request="Investiga el retraso.", dataset_id="orders_daily",
        domain="commerce", environment="production", incident_type="freshness",
        as_of=ALERT_TIME, triage=decision, trace_calls=calls,
    )
    assert investigation.status == "grounded_answer", calls
    assert {citation.source_type for citation in investigation.citations} == REQUIRED_SOURCE_TYPES
    assert {call["tool"] for call in calls} == {"file_search", "knowledge_agent"}
    assert all(call["success"] for call in calls)
    search_call = next(call for call in calls if call["tool"] == "file_search")
    assert {"source_id", "title", "content", "score", "metadata"} <= set(
        search_call["result"][0]
    )


def test_integrated_sdk_abstains_without_credentials_or_vector_store(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_VECTOR_STORE_ID", raising=False)
    decision = TriageDecision(
        severity="INFO", summary="Sin evidencia suficiente.", evidence=[],
        hypotheses=[], recommended_actions=[], needs_human_approval=False,
        confidence=0.3,
    )
    calls = []
    result = investigate_with_documents(
        request="Investiga.", dataset_id="unknown_dataset", domain="unknown",
        environment="production", incident_type="freshness", as_of=ALERT_TIME,
        triage=decision, trace_calls=calls,
    )
    assert result.status == "insufficient_evidence"
    assert result.citations == []
    assert calls[0]["tool"] == "file_search"
    assert calls[0]["success"] is False


def test_file_search_failure_abstains_without_fabricating_citations(monkeypatch):
    class FakeFileSearchTool:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeAgent:
        def __init__(self, **kwargs):
            self.tools = kwargs["tools"]

    class BrokenRunner:
        @staticmethod
        def run_sync(agent, prompt):
            raise RuntimeError("simulated retrieval outage")

    agents_module = ModuleType("agents")
    agents_module.Agent = FakeAgent
    agents_module.Runner = BrokenRunner
    agents_module.FileSearchTool = FakeFileSearchTool
    monkeypatch.setitem(sys.modules, "agents", agents_module)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_VECTOR_STORE_ID", "vs_test")
    decision = TriageDecision(
        severity="P1", summary="P1 requiere revisión humana.", evidence=[],
        hypotheses=[], recommended_actions=[], needs_human_approval=True,
        confidence=0.5,
    )
    calls = []
    result = investigate_with_documents(
        request="Investiga.", dataset_id="orders_daily", domain="commerce",
        environment="production", incident_type="freshness", as_of=ALERT_TIME,
        triage=decision, trace_calls=calls,
    )
    assert result.status == "insufficient_evidence"
    assert result.citations == []
    assert all(call["success"] is False for call in calls)

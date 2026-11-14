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
    _extract_file_search_results,
    build_metadata_filters,
    investigate_with_documents,
)
from app.schemas import (
    GroundedStatement,
    KnowledgeInvestigation,
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
    return KnowledgeInvestigation(
        status="supported",
        summary="La evidencia cubre las cuatro categorías necesarias.",
        findings=[GroundedStatement(
            text="El dataset es crítico y el retraso cruza el umbral P1.",
            citation_ids=source_ids,
        )],
        recommendations=[GroundedStatement(
            text="Escalar al equipo de guardia y revisar la última ejecución.",
            citation_ids=source_ids,
        )],
        citations=citations,
    )


def test_corpus_has_20_markdown_documents_with_required_versioned_metadata():
    paths = list((Path(__file__).resolve().parents[1] / "knowledge").rglob("*.md"))
    documents = load_knowledge_documents()
    assert len(paths) == len(documents) == 20
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
    assert len(clauses) == 8


def test_retrieval_rejects_invalid_source_types_and_limits():
    with pytest.raises(ValueError, match="source_types"):
        _order_docs(source_types=["secret_store"])
    with pytest.raises(ValueError, match="limit"):
        _order_docs(limit=21)


def test_supported_investigation_requires_findings_and_citations():
    with pytest.raises(ValidationError, match="hallazgos y citas"):
        KnowledgeInvestigation(status="supported", summary="Sin fuentes")


def test_abstained_investigation_cannot_include_uncited_claims():
    with pytest.raises(ValidationError, match="no puede presentar"):
        KnowledgeInvestigation(
            status="abstained", summary="No hay evidencia",
            abstention_reason="Faltan fuentes",
            findings=[GroundedStatement(text="afirmación", citation_ids=["x"])],
        )


def test_grounding_requires_all_source_types_and_verifiable_quotes():
    docs = _order_docs()
    investigation = _supported_investigation(docs)
    assert validate_grounding(investigation, docs).status == "supported"
    incomplete = [doc for doc in docs if doc["source_type"] != "escalation"]
    rejected = validate_grounding(investigation, incomplete)
    assert rejected.status == "abstained"
    assert "escalation" in rejected.abstention_reason
    wrong_quote = investigation.model_copy(deep=True)
    wrong_quote.citations[0].excerpt = "Texto que no existe en la fuente"
    assert validate_grounding(wrong_quote, docs).status == "abstained"


def test_raw_file_search_result_parser_keeps_citable_text_and_metadata():
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
    docs = _extract_file_search_results(run)
    assert docs[0]["source_id"] == "CAT-ORDERS-001"
    assert "SLA: 60 minutes." in docs[0]["content"]


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
    assert investigation.status == "supported", calls
    assert {citation.source_type for citation in investigation.citations} == REQUIRED_SOURCE_TYPES
    assert {call["tool"] for call in calls} == {"file_search", "knowledge_agent"}
    assert all(call["success"] for call in calls)


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
    assert result.status == "abstained"
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
    assert result.status == "abstained"
    assert result.citations == []
    assert all(call["success"] is False for call in calls)

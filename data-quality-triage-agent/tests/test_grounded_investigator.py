import json
from pathlib import Path

import pytest

from app.investigator import run_investigation, validate_grounding
from app.knowledge import search_knowledge
from app.schemas import Finding, InvestigationResult


REFERENCE_ALERT = {
    "dataset": "orders_daily",
    "environment": "production",
    "alert_type": "freshness",
    "observed_value_minutes": 186,
    "expected_sla_minutes": 60,
    "timestamp": "2026-11-06T08:00:00Z",
}


def test_reference_incident_returns_grounded_result_with_retrieved_citations(tmp_path):
    result = run_investigation(REFERENCE_ALERT, trace_dir=tmp_path)

    assert result.status == "grounded_answer"
    assert result.severity == "P1"
    assert result.needs_human_approval is True
    assert result.summary == "La frescura de orders_daily supera tres veces su SLA de producción."
    assert result.findings[0].sources == ["catalog/orders_daily.md#criticality"]
    assert result.findings[1].sources == ["runbooks/freshness_incident.md#p1-escalation"]
    assert result.recommended_actions == [
        "Abrir borrador de incidente P1.",
        "Escalar al on-call de Payments Data.",
        "Revisar la ejecución upstream de payment_events.",
    ]

    investigation_trace = next(tmp_path.glob("investigation-*.json"))
    trace = json.loads(investigation_trace.read_text(encoding="utf-8"))
    retrieved = {
        chunk["source_id"]
        for chunk in trace["tool_calls"][0]["result"]
    }
    cited = set(trace["cited_source_ids"])
    assert cited <= retrieved
    assert all("untrusted" not in source for source in retrieved)
    allowed_support_sources = retrieved | {"alert://input"}
    assert all(
        set(item["sources"]) <= allowed_support_sources
        for item in trace["claim_support"]
    )
    assert {
        "Abrir borrador de incidente P1.",
        "Escalar al on-call de Payments Data.",
        "Revisar la ejecución upstream de payment_events.",
    } <= {item["claim"] for item in trace["claim_support"]}
    assert trace["final_output"] == result.model_dump(mode="json")


def test_search_excludes_deprecated_and_untrusted_documents():
    chunks = search_knowledge(
        "orders_daily production freshness P1 escalation no relanzar",
        dataset_id="orders_daily",
        environment="production",
        max_results=20,
    )
    source_ids = {chunk.source_id for chunk in chunks}

    assert "runbooks/freshness_incident.md#p1-escalation" in source_ids
    assert not any("deprecated_orders_escalation" in source for source in source_ids)
    assert not any("untrusted_instructions" in source for source in source_ids)


def test_validation_rejects_a_citation_not_returned_by_retrieval():
    retrieved = search_knowledge(
        "orders_daily production freshness P1 escalation",
        dataset_id="orders_daily",
        environment="production",
        max_results=8,
    )
    result = InvestigationResult(
        status="grounded_answer",
        severity="P1",
        summary="Resultado de prueba.",
        findings=[Finding(claim="Afirmación no permitida.", sources=["missing.md#source"])],
        recommended_actions=[],
        unknowns=[],
        needs_human_approval=True,
    )

    with pytest.raises(ValueError, match="no recuperadas"):
        validate_grounding(result, retrieved)


def test_agent_abstains_when_runbook_evidence_is_missing(tmp_path):
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "catalog.md").write_text(
        """---
document_id: catalog/orders_daily.md
title: Catálogo reducido
dataset: orders_daily
environment: production
status: active
trusted: true
---

# Criticality

orders_daily es gold y crítico para checkout.
""",
        encoding="utf-8",
    )

    result = run_investigation(
        REFERENCE_ALERT,
        trace_dir=tmp_path / "traces",
        knowledge_dir=knowledge_dir,
    )

    assert result.status == "insufficient_evidence"
    assert result.findings == []
    assert any("Faltan fuentes documentales" in item for item in result.unknowns)

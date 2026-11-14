import json

import app.agent as agent
from app.schemas import TriageDecision


def test_orders_daily_reads_metadata_and_metrics_and_returns_contract(tmp_path):
    decision = agent.run_triage(
        "Revisa orders_daily",
        "orders_daily",
        trace_dir=tmp_path,
    )

    assert isinstance(decision, TriageDecision)
    traces = list(tmp_path.glob("*.json"))
    assert len(traces) == 1
    trace = json.loads(traces[0].read_text(encoding="utf-8"))
    called_tools = {call["tool"] for call in trace["tool_calls"]}
    assert {"read_dataset_metadata", "read_quality_metrics"} <= called_tools
    assert trace["final_output"]["severity"] == decision.severity


def test_tool_failure_does_not_invent_missing_quality_evidence(
    tmp_path, monkeypatch
):
    def fail_quality_tool(dataset_id):
        raise RuntimeError("metrics service unavailable")

    monkeypatch.setitem(
        agent.READ_ONLY_TOOLS,
        "read_quality_metrics",
        fail_quality_tool,
    )
    decision = agent.run_triage(
        "Investiga la alerta de orders_daily",
        "orders_daily",
        trace_dir=tmp_path,
    )

    assert isinstance(decision, TriageDecision)
    assert decision.severity == "INFO"
    assert not any("Valores nulos:" in item for item in decision.evidence)
    assert not any("Duplicados:" in item for item in decision.evidence)
    assert any("evidencia insuficiente" in item for item in decision.evidence)
    assert any("métricas" in item for item in decision.recommended_actions)

    trace = json.loads(
        next(tmp_path.glob("*.json")).read_text(encoding="utf-8")
    )
    failed_call = next(
        call for call in trace["tool_calls"]
        if call["tool"] == "read_quality_metrics"
    )
    assert failed_call["success"] is False
    assert failed_call["error"]["type"] == "RuntimeError"

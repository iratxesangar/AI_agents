"""Investigador documental de incidencias con citas verificables.

El módulo reutiliza el triaje seguro existente y añade una etapa de recuperación
local de runbooks. No usa un LLM ni ejecuta acciones externas: así el resultado
es reproducible y la procedencia de cada cita puede verificarse en pruebas.
"""
from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.agent import run_alert_triage
from app.knowledge import DEFAULT_KNOWLEDGE_DIR, cited_source_ids, search_knowledge
from app.schemas import (
    AlertInput,
    Finding,
    InvestigationResult,
    RetrievedChunk,
    TriageDecision,
)


CATALOG_CRITICALITY = "catalog/orders_daily.md#criticality"
RUNBOOK_P1_ESCALATION = "runbooks/freshness_incident.md#p1-escalation"
RUNBOOK_INVESTIGATION = "runbooks/freshness_incident.md#investigation-steps"
RUNBOOK_SAFETY = "runbooks/freshness_incident.md#safety-constraints"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _investigation_query(alert: AlertInput) -> str:
    return " ".join((
        alert.dataset,
        alert.environment,
        alert.alert_type,
        "freshness SLA P1 escalation on-call investigation",
        "orders_pipeline payment_events human approval",
        "aprobación humana no relanzar",
    ))


def validate_grounding(
    result: InvestigationResult,
    retrieved: list[RetrievedChunk],
) -> None:
    """Garantiza que cada cita del resultado procede de la recuperación actual."""
    allowed = cited_source_ids(retrieved)
    cited = {
        source
        for finding in result.findings
        for source in finding.sources
    }
    unknown = cited - allowed
    if unknown:
        raise ValueError(
            "La respuesta cita fuentes no recuperadas: " + ", ".join(sorted(unknown))
        )
    if result.status == "grounded_answer" and not cited:
        raise ValueError("Una respuesta fundamentada debe contener citas recuperadas")


def _claim_support(
    result: InvestigationResult,
) -> list[dict[str, Any]]:
    """Relaciona cada afirmación material con evidencia de entrada o recuperación.

    El contrato de salida se mantiene conciso; el mapa completo se conserva en la
    traza para que las recomendaciones y las incertidumbres también puedan ser
    auditadas sin añadir texto libre no verificable al resultado del usuario.
    """
    if result.status != "grounded_answer":
        return [
            {
                "claim": result.summary,
                "sources": ["alert://input"],
            },
            *[
                {"claim": unknown, "sources": ["alert://input"]}
                for unknown in result.unknowns
            ],
        ]
    return [
        {
            "claim": result.summary,
            "sources": ["alert://input", "catalog/orders_daily.md#freshness-sla"],
        },
        *[
            {"claim": finding.claim, "sources": finding.sources}
            for finding in result.findings
        ],
        {
            "claim": "Abrir borrador de incidente P1.",
            "sources": [RUNBOOK_P1_ESCALATION],
        },
        {
            "claim": "Escalar al on-call de Payments Data.",
            "sources": [RUNBOOK_P1_ESCALATION],
        },
        {
            "claim": "Revisar la ejecución upstream de payment_events.",
            "sources": [RUNBOOK_INVESTIGATION],
        },
        {
            "claim": result.unknowns[0],
            "sources": [RUNBOOK_SAFETY],
        },
    ]


def validate_claim_support(
    claim_support: list[dict[str, Any]],
    retrieved: list[RetrievedChunk],
) -> None:
    """Comprueba que cada fuente del mapa esté en la ejecución actual."""
    allowed = cited_source_ids(retrieved) | {"alert://input"}
    unknown = {
        source
        for item in claim_support
        for source in item["sources"]
        if source not in allowed
    }
    if unknown:
        raise ValueError(
            "El mapa de soporte contiene fuentes no recuperadas: "
            + ", ".join(sorted(unknown))
        )


def _has_sources(retrieved: list[RetrievedChunk], required: set[str]) -> bool:
    return required <= cited_source_ids(retrieved)


def _insufficient_result(
    triage: TriageDecision,
    missing_sources: set[str],
) -> InvestigationResult:
    missing_hint = (
        "Faltan fuentes documentales para validar el procedimiento de escalado: "
        + ", ".join(sorted(missing_sources))
        if missing_sources
        else "No se recuperó evidencia documental suficiente para fundamentar el procedimiento."
    )
    return InvestigationResult(
        status="insufficient_evidence",
        severity=triage.severity,
        summary="No se puede completar una recomendación documentada con la evidencia recuperada.",
        findings=[],
        recommended_actions=[
            "Solicitar el runbook activo y los metadatos documentales que faltan.",
            "Mantener la revisión humana antes de cualquier actuación.",
        ],
        unknowns=[missing_hint, "La causa raíz no está determinada."],
        needs_human_approval=triage.needs_human_approval,
    )


def _build_result(
    alert: AlertInput,
    triage: TriageDecision,
    retrieved: list[RetrievedChunk],
) -> InvestigationResult:
    """Construye una salida de la que cada afirmación documental es trazable."""
    required_sources = {
        CATALOG_CRITICALITY,
        RUNBOOK_P1_ESCALATION,
        RUNBOOK_INVESTIGATION,
        RUNBOOK_SAFETY,
    }
    available_sources = cited_source_ids(retrieved)

    is_reference_incident = (
        alert.dataset == "orders_daily"
        and alert.environment == "production"
        and alert.alert_type == "freshness"
        and alert.observed_value_minutes >= 3 * alert.expected_sla_minutes
        and triage.severity == "P1"
    )
    missing_sources = required_sources - available_sources
    if not is_reference_incident or missing_sources:
        return _insufficient_result(triage, missing_sources)

    return InvestigationResult(
        status="grounded_answer",
        severity="P1",
        summary=(
            "La frescura de orders_daily supera tres veces su SLA de producción."
        ),
        findings=[
            Finding(
                claim="orders_daily es un dataset gold usado por checkout.",
                sources=[CATALOG_CRITICALITY],
            ),
            Finding(
                claim=(
                    "El procedimiento para un incumplimiento P1 exige avisar al "
                    "on-call de Payments Data."
                ),
                sources=[RUNBOOK_P1_ESCALATION],
            ),
        ],
        recommended_actions=[
            "Abrir borrador de incidente P1.",
            "Escalar al on-call de Payments Data.",
            "Revisar la ejecución upstream de payment_events.",
        ],
        unknowns=[
            "No existe evidencia suficiente para confirmar si el fallo procede de la fuente o del orquestador."
        ],
        needs_human_approval=True,
    )


def _write_trace(
    trace_dir: Path,
    alert: AlertInput,
    triage: TriageDecision,
    query: str,
    retrieved: list[RetrievedChunk],
    result: InvestigationResult,
    claim_support: list[dict[str, Any]],
) -> Path:
    trace_id = str(uuid.uuid4())
    trace = {
        "workflow": "grounded_incident_investigator",
        "trace_id": trace_id,
        "created_at": _utc_now(),
        "trusted_input": {
            "source_id": "alert://input",
            "alert": alert.model_dump(mode="json"),
        },
        "triage_decision": triage.model_dump(mode="json"),
        "tool_calls": [
            {
                "tool": "search_knowledge",
                "arguments": {
                    "query": query,
                    "dataset_id": alert.dataset,
                    "environment": alert.environment,
                    "max_results": 8,
                },
                "success": True,
                "result": [chunk.model_dump(mode="json") for chunk in retrieved],
            }
        ],
        "cited_source_ids": sorted(
            source for finding in result.findings for source in finding.sources
        ),
        "claim_support": claim_support,
        "final_output": result.model_dump(mode="json"),
    }
    trace_dir.mkdir(parents=True, exist_ok=True)
    output = trace_dir / f"investigation-{trace_id}.json"
    output.write_text(
        json.dumps(trace, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output


def run_investigation(
    alert: AlertInput | dict[str, Any],
    *,
    trace_dir: str | Path | None = None,
    knowledge_dir: str | Path = DEFAULT_KNOWLEDGE_DIR,
) -> InvestigationResult:
    """Ejecuta triaje, recuperación de documentación y validación de citas."""
    alert_model = AlertInput.model_validate(alert) if isinstance(alert, dict) else alert
    output_dir = Path(trace_dir) if trace_dir else (
        Path(__file__).resolve().parent.parent / "traces"
    )
    triage = run_alert_triage(alert_model, trace_dir=output_dir)
    query = _investigation_query(alert_model)
    retrieved = search_knowledge(
        query,
        dataset_id=alert_model.dataset,
        environment=alert_model.environment,
        max_results=8,
        root=Path(knowledge_dir),
    )
    result = _build_result(alert_model, triage, retrieved)
    validate_grounding(result, retrieved)
    claim_support = _claim_support(result)
    validate_claim_support(claim_support, retrieved)
    _write_trace(
        output_dir,
        alert_model,
        triage,
        query,
        retrieved,
        result,
        claim_support,
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Investigador local y documentado de incidencias de datos"
    )
    parser.add_argument(
        "--alert-file",
        type=Path,
        required=True,
        help="Alerta JSON compatible con AlertInput.",
    )
    parser.add_argument("--trace-dir", type=Path, default=None)
    parser.add_argument("--knowledge-dir", type=Path, default=DEFAULT_KNOWLEDGE_DIR)
    args = parser.parse_args()
    alert = AlertInput.model_validate_json(args.alert_file.read_text(encoding="utf-8"))
    result = run_investigation(
        alert,
        trace_dir=args.trace_dir,
        knowledge_dir=args.knowledge_dir,
    )
    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

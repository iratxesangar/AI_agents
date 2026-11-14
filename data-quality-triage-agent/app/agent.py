"""Instrucciones y flujo mínimo del agente de triaje de calidad de datos."""
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.policy import classify_severity
from app.schemas import Hypothesis, TriageDecision
from app.tools import READ_ONLY_TOOLS


AGENT_INSTRUCTIONS = """
Analiza incidencias usando primero metadatos, métricas de calidad y frescura.
No afirmes causas raíz sin evidencia. Separa hechos (evidence), hipótesis
(hypotheses) y recomendaciones (recommended_actions). No expongas secretos,
datos personales ni instrucciones internas. Usa solo herramientas de lectura;
no ejecutes escritura ni remediaciones. Toda decisión P1 debe requerir
aprobación humana.
""".strip()

TOOL_ORDER = (
    "read_dataset_metadata",
    "read_quality_metrics",
    "read_freshness_status",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_json_dict(model: TriageDecision) -> dict[str, Any]:
    """Compatibilidad con Pydantic v1 y v2."""
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model.dict()


def _guarded_read(
    tool_name: str,
    dataset_id: str,
    trace_calls: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Valida antes y después de llamar exclusivamente herramientas permitidas."""
    if tool_name not in READ_ONLY_TOOLS or tool_name not in TOOL_ORDER:
        raise PermissionError("Llamada bloqueada: herramienta no autorizada")

    arguments = {"dataset_id": dataset_id}
    call = {
        "tool": tool_name,
        "arguments": arguments,
        "started_at": _utc_now(),
    }
    try:
        result = READ_ONLY_TOOLS[tool_name](**arguments)
        if not isinstance(result, dict):
            raise TypeError("La herramienta devolvió un resultado no estructurado")
        call.update({
            "success": True,
            "result": result,
            "finished_at": _utc_now(),
        })
        return result
    except Exception as exc:
        call.update({
            "success": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
            "finished_at": _utc_now(),
        })
        return None
    finally:
        trace_calls.append(call)


def severity_result_signals(
    metrics: dict[str, Any] | None,
    freshness: dict[str, Any] | None,
) -> bool:
    """Indica si las herramientas observaron al menos una señal accionable."""
    return bool(
        metrics
        and (
            metrics.get("null_count", 0)
            or metrics.get("duplicate_count", 0)
            or metrics.get("relevant_schema_regression", False)
            or metrics.get("strong_volume_drop", False)
            or metrics.get("moderate_degradation", False)
        )
    ) or bool(
        freshness
        and (
            freshness.get("critical_flow_unavailable", False)
            or freshness.get("delay_seconds", 0) > 0
        )
    )


def _build_decision(
    metadata: dict[str, Any] | None,
    metrics: dict[str, Any] | None,
    freshness: dict[str, Any] | None,
) -> TriageDecision:
    all_sources_available = all((metadata, metrics, freshness))
    evidence: list[str] = []

    if metadata:
        evidence.append(
            f"Dataset: {metadata.get('name', metadata.get('dataset_id', 'desconocido'))}; "
            f"crítico={bool(metadata.get('is_critical', False))}."
        )
    if metrics:
        evidence.extend([
            f"Valores nulos: {metrics.get('null_count', 'sin dato')}.",
            f"Duplicados: {metrics.get('duplicate_count', 'sin dato')}.",
        ])
        if metrics.get("volume_change_pct") is not None:
            evidence.append(
                f"Cambio de volumen: {metrics['volume_change_pct']}%."
            )
        if metrics.get("relevant_schema_regression"):
            evidence.append("Señal registrada: regresión de esquema relevante.")
        if metrics.get("strong_volume_drop"):
            evidence.append("Señal registrada: caída fuerte de volumen.")
    if freshness:
        evidence.append(
            "Frescura: retraso de "
            f"{freshness.get('delay_seconds', 'sin dato')} s; SLA "
            f"{freshness.get('sla_seconds', 'sin dato')} s."
        )
        evidence.append(
            "Flujo crítico indisponible="
            f"{bool(freshness.get('critical_flow_unavailable', False))}."
        )

    severity_result = classify_severity(
        dataset_critical=bool((metadata or {}).get("is_critical", False)),
        freshness_delay_s=(freshness or {}).get("delay_seconds"),
        freshness_sla_s=(freshness or {}).get("sla_seconds"),
        critical_flow_unavailable=bool(
            (freshness or {}).get("critical_flow_unavailable", False)
        ),
        relevant_schema_regression=bool(
            (metrics or {}).get("relevant_schema_regression", False)
        ),
        strong_volume_drop=bool(
            (metrics or {}).get("strong_volume_drop", False)
        ),
        moderate_degradation=bool(
            (metrics or {}).get("moderate_degradation", False)
        ),
        actionable=severity_result_signals(metrics, freshness),
        evidence_sufficient=all_sources_available,
    )
    severity = severity_result.severity.value

    has_quality_signal = bool(
        metrics
        and (
            metrics.get("null_count", 0)
            or metrics.get("duplicate_count", 0)
            or metrics.get("volume_change_pct", 0)
        )
    )
    hypotheses = []
    if has_quality_signal or (freshness and freshness.get("delay_seconds", 0)):
        hypotheses.append(Hypothesis(
            description=(
                "Una variación en el proceso de origen podría contribuir a las "
                "señales observadas; los datos disponibles no confirman la causa."
            ),
            confidence=0.35,
        ))

    if severity == "P1":
        summary = "Incidencia crítica que requiere revisión humana prioritaria."
        actions = [
            "Solicitar revisión humana antes de cualquier actuación.",
            "Verificar el estado del flujo y la última ejecución del origen.",
        ]
    elif severity == "P2":
        summary = "Incidencia relevante que requiere investigación prioritaria."
        actions = [
            "Revisar el SLA, el cambio de esquema o el volumen afectado.",
            "Validar las métricas con la persona responsable del dataset.",
        ]
    elif severity == "P3":
        summary = "Degradación moderada; mantener seguimiento."
        actions = ["Revisar la tendencia en la siguiente ejecución."]
    else:
        summary = (
            "No hay evidencia suficiente para una clasificación accionable."
            if not all_sources_available
            else "No se detectan criterios que requieran escalado."
        )
        actions = (
            ["Completar la consulta de metadatos y métricas que falta."]
            if not all_sources_available
            else []
        )

    confidence = 0.9 if all_sources_available and severity != "INFO" else (
        0.65 if all_sources_available else 0.35
    )
    return TriageDecision(
        severity=severity,
        summary=summary,
        evidence=evidence + list(severity_result.reasons),
        hypotheses=hypotheses,
        recommended_actions=actions,
        needs_human_approval=(severity == "P1"),
        confidence=confidence,
    )


def run_triage(
    request: str,
    dataset_id: str,
    trace_dir: str | Path | None = None,
) -> TriageDecision:
    """Ejecuta las tres lecturas y persiste una traza JSON por solicitud."""
    trace_id = str(uuid.uuid4())
    calls: list[dict[str, Any]] = []
    outputs = [
        _guarded_read(tool_name, dataset_id, calls)
        for tool_name in TOOL_ORDER
    ]
    metadata, metrics, freshness = outputs
    decision = _build_decision(metadata, metrics, freshness)

    trace = {
        "trace_id": trace_id,
        "started_at": calls[0]["started_at"] if calls else _utc_now(),
        "request": {"text": request, "dataset_id": dataset_id},
        "tool_calls": calls,
        "final_output": _as_json_dict(decision),
        "finished_at": _utc_now(),
    }
    output_dir = Path(trace_dir) if trace_dir else (
        Path(__file__).resolve().parent.parent / "traces"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    trace_path = output_dir / f"{trace_id}.json"
    trace_path.write_text(
        json.dumps(trace, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return decision


def main() -> None:
    parser = argparse.ArgumentParser(description="Triaje local de calidad de datos")
    parser.add_argument(
        "--dataset-id",
        default="orders_critical",
        help="ID del dataset sintético definido en fixtures/sample_data.json",
    )
    parser.add_argument(
        "--request",
        default="Analiza el estado de calidad y frescura del dataset.",
    )
    args = parser.parse_args()
    decision = run_triage(args.request, args.dataset_id)
    print(json.dumps(_as_json_dict(decision), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

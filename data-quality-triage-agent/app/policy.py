"""Reglas deterministas para clasificar la severidad de incidencias de calidad.

La clasificación se ejecuta en código y no depende de que el modelo interprete
una política incluida únicamente en un prompt.
"""
from dataclasses import dataclass
from enum import Enum


class Severity(str, Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    INFO = "INFO"


@dataclass(frozen=True)
class SeverityResult:
    severity: Severity
    reasons: tuple[str, ...]


def classify_severity(
    *,
    dataset_critical: bool = False,
    freshness_delay_s: float | None = None,
    freshness_sla_s: float | None = None,
    critical_flow_unavailable: bool = False,
    relevant_schema_regression: bool = False,
    strong_volume_drop: bool = False,
    moderate_degradation: bool = False,
    actionable: bool = True,
    evidence_sufficient: bool = True,
) -> SeverityResult:
    """Clasifica una incidencia aplicando umbrales inclusivos y precedencia.

    El ratio de frescura solo se calcula cuando se conocen ambos valores y el
    SLA es positivo. Un retraso exactamente igual a 1.5× o 3× cumple el umbral.
    """
    if freshness_delay_s is not None and freshness_delay_s < 0:
        raise ValueError("freshness_delay_s no puede ser negativo")
    if freshness_sla_s is not None and freshness_sla_s <= 0:
        raise ValueError("freshness_sla_s debe ser mayor que cero")

    ratio = None
    if freshness_delay_s is not None and freshness_sla_s is not None:
        ratio = freshness_delay_s / freshness_sla_s

    if critical_flow_unavailable:
        return SeverityResult(
            Severity.P1, ("flujo crítico indisponible",)
        )
    if dataset_critical and ratio is not None and ratio >= 3:
        return SeverityResult(
            Severity.P1,
            (f"dataset crítico con retraso de frescura de {ratio:.2f}× SLA",),
        )

    p2_reasons = []
    if ratio is not None and ratio >= 1.5:
        p2_reasons.append(f"SLA de frescura superado ({ratio:.2f}×)")
    if relevant_schema_regression:
        p2_reasons.append("regresión de esquema relevante")
    if strong_volume_drop:
        p2_reasons.append("caída fuerte de volumen")
    if p2_reasons:
        return SeverityResult(Severity.P2, tuple(p2_reasons))

    if not actionable or not evidence_sufficient:
        reason = (
            "alerta no accionable"
            if not actionable
            else "evidencia insuficiente para clasificar una incidencia"
        )
        return SeverityResult(Severity.INFO, (reason,))

    if moderate_degradation:
        return SeverityResult(
            Severity.P3, ("degradación moderada; requiere seguimiento",)
        )

    return SeverityResult(
        Severity.INFO, ("no se detectan criterios de escalado",)
    )

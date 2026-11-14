"""Contratos estrictos de entrada y salida del agente de triaje."""
from datetime import datetime
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class StrictOutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AlertInput(StrictOutputModel):
    dataset: str = Field(min_length=1)
    environment: str = Field(min_length=1)
    alert_type: Literal["freshness", "volume", "schema", "quality"]
    observed_value_minutes: float = Field(ge=0)
    expected_sla_minutes: float = Field(gt=0)
    timestamp: datetime


class Hypothesis(StrictOutputModel):
    description: str
    confidence: float = Field(ge=0, le=1)


class TriageDecision(StrictOutputModel):
    severity: Literal["P1", "P2", "P3", "INFO"]
    summary: str
    evidence: list[str]
    hypotheses: list[Hypothesis]
    recommended_actions: list[str]
    needs_human_approval: bool
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def require_human_approval_for_p1(self):
        if self.severity == "P1" and not self.needs_human_approval:
            raise ValueError("Toda incidencia P1 requiere aprobación humana")
        return self


class RetrievedChunk(StrictOutputModel):
    """Un fragmento documental devuelto por la herramienta de recuperación."""

    source_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    score: float = Field(ge=0)
    metadata: dict[str, Any]


class Finding(StrictOutputModel):
    """Una afirmación que debe estar vinculada a uno o varios fragmentos."""

    claim: str = Field(min_length=1)
    sources: list[str] = Field(min_length=1)

    @field_validator("sources")
    @classmethod
    def reject_blank_source_ids(cls, sources: list[str]) -> list[str]:
        if any(not source.strip() for source in sources):
            raise ValueError("Las citas no pueden estar vacías")
        return sources


class InvestigationResult(StrictOutputModel):
    """Salida trazable del investigador documental de incidencias."""

    status: Literal["grounded_answer", "insufficient_evidence"]
    severity: Literal["P1", "P2", "P3", "INFO"]
    summary: str = Field(min_length=1)
    findings: list[Finding]
    recommended_actions: list[str]
    unknowns: list[str]
    needs_human_approval: bool

    @model_validator(mode="after")
    def validate_grounded_result(self):
        if self.severity == "P1" and not self.needs_human_approval:
            raise ValueError("Toda incidencia P1 requiere aprobación humana")
        if self.status == "grounded_answer" and not self.findings:
            raise ValueError("Una respuesta fundamentada requiere hallazgos citados")
        if self.status == "grounded_answer" and any(
            not finding.sources for finding in self.findings
        ):
            raise ValueError("Cada hallazgo fundamentado requiere citas")
        return self

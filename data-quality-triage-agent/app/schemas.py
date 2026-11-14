"""Contratos estrictos de entrada y salida del agente de triaje."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class RetrievedChunk(StrictOutputModel):
    """Fragmento devuelto por la recuperación y permitido como fuente de cita."""

    source_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    score: float
    metadata: dict[str, Any]


class SourceCitation(StrictOutputModel):
    source_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    source_type: Literal[
        "runbook", "catalog", "deployment_history", "escalation", "ownership"
    ]
    uri: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)


class Finding(StrictOutputModel):
    claim: str = Field(min_length=1)
    sources: list[str] = Field(min_length=1)


class InvestigationResult(StrictOutputModel):
    status: Literal["grounded_answer", "insufficient_evidence"]
    severity: Literal["P1", "P2", "P3", "INFO"]
    summary: str
    findings: list[Finding]
    recommended_actions: list[str]
    unknowns: list[str]
    needs_human_approval: bool
    # Resuelve los IDs de Finding.sources en citas inspeccionables y verificables.
    citations: list[SourceCitation]

    @model_validator(mode="after")
    def enforce_evidence_or_insufficient_status(self):
        if self.severity == "P1" and not self.needs_human_approval:
            raise ValueError("Toda investigación P1 requiere aprobación humana")
        citation_ids = {citation.source_id for citation in self.citations}
        if self.status == "grounded_answer":
            if not self.findings or not self.citations:
                raise ValueError(
                    "grounded_answer requiere hallazgos y citas"
                )
            for finding in self.findings:
                if not set(finding.sources) <= citation_ids:
                    raise ValueError(
                        "Cada finding.sources debe corresponder a citas incluidas"
                    )
        elif self.findings or self.citations:
            raise ValueError(
                "insufficient_evidence no puede presentar hallazgos ni citas"
            )
        elif not self.unknowns:
            raise ValueError(
                "insufficient_evidence debe indicar qué evidencia se desconoce"
            )
        return self


class TriageDecision(StrictOutputModel):
    severity: Literal["P1", "P2", "P3", "INFO"]
    summary: str
    evidence: list[str]
    hypotheses: list[Hypothesis]
    recommended_actions: list[str]
    needs_human_approval: bool
    confidence: float = Field(ge=0, le=1)
    investigation: InvestigationResult | None = None

    @model_validator(mode="after")
    def require_human_approval_for_p1(self):
        if self.severity == "P1" and not self.needs_human_approval:
            raise ValueError("Toda incidencia P1 requiere aprobación humana")
        return self

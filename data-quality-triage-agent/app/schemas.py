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
        "runbook", "catalog", "deployment_history", "escalation"
    ]
    uri: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)


class GroundedStatement(StrictOutputModel):
    text: str = Field(min_length=1)
    citation_ids: list[str] = Field(min_length=1)


class KnowledgeInvestigation(StrictOutputModel):
    status: Literal["supported", "abstained"]
    summary: str
    findings: list[GroundedStatement] = Field(default_factory=list)
    recommendations: list[GroundedStatement] = Field(default_factory=list)
    citations: list[SourceCitation] = Field(default_factory=list)
    abstention_reason: str | None = None

    @model_validator(mode="after")
    def enforce_evidence_or_abstention(self):
        if self.status == "supported":
            if not self.citations or not self.findings:
                raise ValueError(
                    "Una investigación supported requiere hallazgos y citas"
                )
            if self.abstention_reason:
                raise ValueError(
                    "Una investigación supported no puede incluir abstention_reason"
                )
            known_ids = {citation.source_id for citation in self.citations}
            for statement in (*self.findings, *self.recommendations):
                if not set(statement.citation_ids) <= known_ids:
                    raise ValueError(
                        "Cada hallazgo y recomendación debe citar fuentes incluidas"
                    )
        else:
            if self.findings or self.recommendations or self.citations:
                raise ValueError(
                    "Una investigación abstained no puede presentar hallazgos, "
                    "recomendaciones ni citas"
                )
            if not self.abstention_reason:
                raise ValueError(
                    "Una investigación abstained debe explicar por qué"
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
    investigation: KnowledgeInvestigation | None = None

    @model_validator(mode="after")
    def require_human_approval_for_p1(self):
        if self.severity == "P1" and not self.needs_human_approval:
            raise ValueError("Toda incidencia P1 requiere aprobación humana")
        return self

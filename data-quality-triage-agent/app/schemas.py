"""Contratos estrictos de entrada y salida del agente de triaje."""
from datetime import datetime
from typing import Literal

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

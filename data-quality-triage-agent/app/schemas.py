"""Contrato estricto de salida del agente de triaje."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictOutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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

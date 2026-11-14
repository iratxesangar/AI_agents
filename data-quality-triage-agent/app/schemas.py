"""Esquemas Pydantic para la salida estructurada del agente."""
from typing import Literal

from pydantic import BaseModel, Field


class Hypothesis(BaseModel):
    description: str
    confidence: float = Field(ge=0, le=1)


class TriageDecision(BaseModel):
    severity: Literal["P1", "P2", "P3", "INFO"]
    summary: str
    evidence: list[str]
    hypotheses: list[Hypothesis]
    recommended_actions: list[str]
    needs_human_approval: bool
    confidence: float = Field(ge=0, le=1)

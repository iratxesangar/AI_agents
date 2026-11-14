import pytest
from pydantic import ValidationError

from app.schemas import Hypothesis, TriageDecision
from app.tools import READ_ONLY_TOOLS


@pytest.mark.parametrize("tool", READ_ONLY_TOOLS.values())
def test_read_tools_reject_unknown_dataset(tool):
    with pytest.raises(KeyError, match="Dataset desconocido"):
        tool("dataset_not_allowed")


@pytest.mark.parametrize("confidence", [-0.01, 1.01])
def test_hypothesis_rejects_confidence_outside_zero_one(confidence):
    with pytest.raises(ValidationError):
        Hypothesis(description="Hipótesis de prueba", confidence=confidence)


@pytest.mark.parametrize("confidence", [-0.01, 1.01])
def test_decision_rejects_confidence_outside_zero_one(confidence):
    with pytest.raises(ValidationError):
        TriageDecision(
            severity="INFO",
            summary="Sin incidencia",
            evidence=[],
            hypotheses=[],
            recommended_actions=[],
            needs_human_approval=False,
            confidence=confidence,
        )


def test_decision_rejects_p1_without_human_approval():
    with pytest.raises(ValidationError, match="requiere aprobación humana"):
        TriageDecision(
            severity="P1",
            summary="Incidencia crítica",
            evidence=[],
            hypotheses=[],
            recommended_actions=[],
            needs_human_approval=False,
            confidence=0.9,
        )


def test_decision_rejects_unmodeled_fields():
    with pytest.raises(ValidationError):
        TriageDecision(
            severity="INFO",
            summary="Sin incidencia",
            evidence=[],
            hypotheses=[],
            recommended_actions=[],
            needs_human_approval=False,
            confidence=0.9,
            root_cause="dato no permitido",
        )

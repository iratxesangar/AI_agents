import json
from pathlib import Path


CASES_PATH = (
    Path(__file__).resolve().parents[1] / "evals" / "cases.json"
)
REQUIRED_CASE_IDS = {f"DQ-{number:02d}" for number in range(1, 14)}
VALID_SEVERITIES = {"P1", "P2", "P3", "INFO"}


def test_evaluation_corpus_has_thirteen_independent_expected_cases():
    suite = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    cases = suite["cases"]
    case_ids = {case["id"] for case in cases}

    assert len(cases) >= 13
    assert REQUIRED_CASE_IDS <= case_ids
    for case in cases:
        assert case["input"]
        assert case["expected"]["severity"] in VALID_SEVERITIES
        assert isinstance(case["expected"]["needs_human_approval"], bool)

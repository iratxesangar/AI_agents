import json
from pathlib import Path

import evals.run_evals as runner


def test_evaluator_records_one_case_failure_without_crashing_suite(
    tmp_path, monkeypatch
):
    case = json.loads(
        runner.CASES_PATH.read_text(encoding="utf-8")
    )["cases"][0]

    def crash_agent(**kwargs):
        raise RuntimeError("synthetic agent failure")

    monkeypatch.setattr(runner, "run_triage_with_tools", crash_agent)
    result = runner._evaluate_case(case, tmp_path)

    assert result["case_pass"] is False
    assert result["schema_valid"] is False
    assert result["error_type"] == "RuntimeError"

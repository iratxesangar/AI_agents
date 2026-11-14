import json

import evals.run_investigation_evals as runner


def test_grounded_evaluation_suite_records_reference_case(tmp_path):
    output = tmp_path / "result.json"
    report = runner.run_suite(output_path=output)

    assert output.exists()
    assert report["metrics"]["case_count"] >= 5
    assert report["metrics"]["case_pass_rate_pct"] == 100.0
    assert all(case["citation_valid"] for case in report["cases"])
    assert json.loads(output.read_text(encoding="utf-8"))["suite"] == "grounded-incident-investigator"

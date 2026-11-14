import json
from pathlib import Path

from evals import run_retrieval_evals


def test_retrieval_evaluation_has_disjoint_development_and_holdout_splits():
    cases_path = Path(__file__).resolve().parents[1] / "evals" / "retrieval_cases.json"
    suite = json.loads(cases_path.read_text(encoding="utf-8"))
    development = suite["development"]
    holdout = suite["holdout"]
    development_ids = {case["id"] for case in development}
    holdout_ids = {case["id"] for case in holdout}

    assert len(development) == 10
    assert len(holdout) == 6
    assert development_ids.isdisjoint(holdout_ids)
    assert len(development_ids | holdout_ids) == 16
    assert all({"query", "filters", "retrieval_source_types", "expected"} <= case.keys()
               for case in (*development, *holdout))


def test_development_run_writes_a_complete_trace_for_every_case(tmp_path, monkeypatch):
    monkeypatch.setattr(run_retrieval_evals, "RESULTS_DIR", tmp_path / "results")

    report = run_retrieval_evals.run(split="development")
    trace_dir = run_retrieval_evals.RESULTS_DIR / "retrieval_traces" / report["run_id"]

    assert len(list(trace_dir.glob("*.json"))) == 10
    for result in report["cases"]:
        trace = json.loads((trace_dir / f"{result['id']}.json").read_text(encoding="utf-8"))
        assert trace["initial_query"]
        assert trace["filters_applied"]
        assert all("score" in document for document in trace["retrieved_documents"])
        assert {"status", "severity", "findings", "citations"} <= trace["structured_response"].keys()
        assert trace["evaluation_result"]["checks"]

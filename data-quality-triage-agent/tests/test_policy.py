from app.policy import Severity, classify_severity


def test_policy_assigns_p1_for_critical_dataset_at_three_sla():
    result = classify_severity(
        dataset_critical=True,
        freshness_delay_s=180,
        freshness_sla_s=60,
    )
    assert result.severity is Severity.P1


def test_policy_assigns_p2_for_sla_at_one_and_a_half():
    result = classify_severity(
        dataset_critical=False,
        freshness_delay_s=90,
        freshness_sla_s=60,
    )
    assert result.severity is Severity.P2


def test_policy_assigns_p3_for_moderate_degradation():
    result = classify_severity(moderate_degradation=True)
    assert result.severity is Severity.P3


def test_policy_assigns_info_when_alert_is_not_actionable():
    result = classify_severity(actionable=False)
    assert result.severity is Severity.INFO

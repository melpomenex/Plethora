use crate::models::study_trail::{
    AssessmentEligibilityPolicy, AssessmentEligibilitySummary, StudyTrailItem,
    StudyTrailItemStatus,
};

pub fn evaluate_assessment_eligibility(
    policy: AssessmentEligibilityPolicy,
    items: &[StudyTrailItem],
) -> AssessmentEligibilitySummary {
    let required: Vec<&StudyTrailItem> = items
        .iter()
        .filter(|item| item.is_required && !item.is_remediation && item.segment_id.is_some())
        .collect();

    let required_total = required.len();
    let required_completed = required
        .iter()
        .filter(|item| item.status.is_completed() || item.status == StudyTrailItemStatus::Skipped)
        .count();
    let checks_passed = required
        .iter()
        .filter(|item| item.status == StudyTrailItemStatus::CheckPassed)
        .count();

    let mut blocking_reasons = Vec::new();
    let eligible = match policy {
        AssessmentEligibilityPolicy::Open => true,
        AssessmentEligibilityPolicy::AssessmentFirst => true,
        AssessmentEligibilityPolicy::Guided => {
            if required_completed < required_total {
                blocking_reasons.push(format!(
                    "{} of {} required reading assignments completed",
                    required_completed, required_total
                ));
                false
            } else {
                true
            }
        }
    };

    AssessmentEligibilitySummary {
        policy,
        eligible,
        required_total,
        required_completed,
        checks_passed,
        blocking_reasons,
        test_out_available: matches!(
            policy,
            AssessmentEligibilityPolicy::AssessmentFirst | AssessmentEligibilityPolicy::Open
        ),
    }
}

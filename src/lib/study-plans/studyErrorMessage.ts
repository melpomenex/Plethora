import { StudyApiError } from '../../api/study-plans';

const messages: Record<string, string> = {
  'study_plan.error.unsupported_platform': 'Study Plans require the native Plethora app.',
  'study_source.error.unsupported_platform': 'Study Plans require the native Plethora app.',
  'study_plan.error.source_ai_excluded': 'A selected source is excluded from AI. Use Source Outline or change the source selection.',
  'study_plan.error.strict_local_required': 'Strict local mode is enabled. Choose an on-device model or a localhost endpoint.',
  'study_plan.error.local_only_generation_required': 'A selected source is local-only. Choose an on-device model or a localhost endpoint.',
  'study_plan.error.local_only_embedding_required': 'A selected source is local-only. Choose a local embedding backend in Settings.',
  'study_plan.error.cloud_disclosure_required': 'Approve the disclosed off-device processing before generating.',
  'study_plan.error.cost_consent_required': 'Approve the execution budget before generating.',
  'study_source.error.too_many_documents': 'Select up to 24 source documents.',
  'study_source.error.too_many_extracts': 'Select up to 200 extracts.',
  'study_generation.error.source_missing': 'A selected source is no longer available. Update the plan’s sources and try again.',
  'study_generation.error.source_changed': 'A selected source changed. Review the plan’s sources before trying again.',
  'study_generation.error.no_provider_available': 'The selected model is unavailable. Check AI settings or use Source Outline.',
  'study_generation.error.invalid_endpoint': 'The model endpoint is invalid. Check the provider’s URL in AI settings.',
  'study_generation.error.provider_changed_on_resume': 'The model, endpoint, or embedding settings changed. Review the new configuration before trying again.',
  'study_generation.error.call_budget_exceeded': 'The generation plan exceeds the approved call budget. Review the settings and start again.',
  'study_generation.error.checkpoint_evidence_changed': 'The verified passages differ from the saved checkpoint. Open the draft and start a new generation run.',
  'study_generation.error.job_unavailable': 'That job is no longer available to resume. Open the saved draft to continue.',
  'study_plan.error.invalid_topic': 'Each published topic needs a title and at least one valid learning objective.',
  'study_plan.error.unverified_topic_source': 'A grounded topic has missing or changed evidence. Review its source before publishing.',
  'study_plan.error.dangling_prerequisite': 'A prerequisite points to a topic that is no longer included.',
  'study_plan.error.dependency_cycle': 'Remove the circular prerequisite before publishing.',
  'study_generation.error.no_active_draft': 'The draft is no longer active. Reopen the plan and create or select a draft.',
  'study_plan.error.stale_revision': 'The draft changed. Reopen it to continue with the latest version.',
  'study_generation.error.no_evidence': 'Search found no matching passages in the selected sources. Try a more specific goal or review the selected sources.',
  'study_generation.error.index_not_ready': 'Search found no matching passages, and the selected sources have no ready library index. Check their indexing status or use Source Outline.',
  'study_generation.error.retrieval_failed': 'Search could not complete for the selected sources. Try again or check the library index.',
  'study_generation.error.unverified_evidence': 'Search found passages, but their sources could not be verified. Check whether the selected sources or their index have changed.',
  'study_grading.error.source_evidence_unavailable': 'The committed source passages are unavailable or changed. Review the answers manually.',
  'study_generation.error.cancelled': 'Generation was cancelled.',
  'study_generation.error.plan_revision_changed': 'The draft changed during generation. Reopen the plan and review the latest draft.',
  'study.assessment.error.empty_paper': 'Add at least one valid question before publishing.',
  'study.assessment.error.quota_shortfall': 'Fill the remaining question slots or accept a shorter paper.',
  'study_generation.error.model_call_budget_exceeded': 'The question count exceeds the approved model-call budget. Review the budget and try again.',
  'study.assessment.error.no_verified_passages': 'The plan has no verified passages for question generation. Generate a source-grounded curriculum or add questions manually.',
  'study_generation.error.target_job_active': 'Generation is already running for this draft.',
  'study_generation.error.no_included_topics': 'The draft has no included topics. Review the saved topics or try Source Outline.',
  'study_generation.error.model_timeout': 'The selected model took too long to respond. Retry or use Source Outline.',
  'study_generation.error.model_context_too_small': 'The selected model cannot fit the curriculum request. Use a model with a larger context window or try Source Outline.',
  'study_generation.error.model_request_failed': 'The selected model could not complete the request. Check the provider or use Source Outline.',
  'study_generation.error.model_declined': 'The selected model declined the request. Your saved draft is still available.',
  'study_generation.error.output_truncated': 'The model response was cut off before the curriculum was complete. Try again or use Source Outline.',
  'study_generation.error.malformed_output': 'The model returned an invalid curriculum. Try another model or use Source Outline.',
};

export function studyErrorMessageForKey(messageKey: string): string | undefined {
  return messages[messageKey];
}

export function studyErrorMessage(error: unknown, fallback: string): string {
  return error instanceof StudyApiError ? studyErrorMessageForKey(error.messageKey) ?? fallback : fallback;
}

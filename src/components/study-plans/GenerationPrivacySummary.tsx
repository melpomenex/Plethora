import type { StudyAiPreflight } from '../../lib/study-plans/generation/types';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface GenerationPrivacySummaryProps {
  preflight: StudyAiPreflight | null;
  purpose?: 'curriculum' | 'assessment' | 'rubric';
  indexedSourceCount?: number | null;
  cloudDisclosureAccepted?: boolean;
  onCloudDisclosureChange?: (accepted: boolean) => void;
  costConsentAccepted?: boolean;
  onCostConsentChange?: (accepted: boolean) => void;
  disabled?: boolean;
}

const localityNames: Record<string, string> = {
  device: 'studyPlans.ui.on-device.a6013f49',
  loopback: 'studyPlans.ui.localhost.bbbc3362',
  lan: 'studyPlans.ui.local-network.647ffb59',
  remote: 'studyPlans.ui.cloud.75c8c746',
  unknown: 'studyPlans.ui.location-unknown.384d7cec',
};

export function GenerationPrivacySummary({
  preflight,
  purpose = 'curriculum',
  indexedSourceCount,
  cloudDisclosureAccepted,
  onCloudDisclosureChange,
  costConsentAccepted,
  onCostConsentChange,
  disabled,
}: GenerationPrivacySummaryProps) {
        useI18n();
        if (!preflight) return null;
  const { model, estimate, embedding, embeddingDestination, generationDestination } = preflight;
  const locality = typeof generationDestination === 'object' ? generationDestination.locality : 'unknown';
  const remoteEmbedding = typeof embeddingDestination === 'object' && embeddingDestination?.sendsOffDevice;
  const offDevice = preflight.sendsSourceOffDevice || remoteEmbedding;
  const providerName = model?.provider ?? preflight.providerId;
  const payload = purpose === 'rubric' ? translateRecentFeature("studyPlans.ui.submitted-written-answers-co.3e864e6d")
    : purpose === 'assessment' ? translateRecentFeature("studyPlans.ui.assessment-topics-question-r.b2f72945")
    : translateRecentFeature("studyPlans.ui.your-learning-goal-selected-.67df2f23");
  const estimatedCost = estimate?.costUsd;
  const priced = estimatedCost != null && Number.isFinite(estimatedCost);
  const cost = !preflight.billable
    ? translateRecentFeature("studyPlans.ui.no-configured-api-charges.4a59c424")
    : priced ? translateRecentFeature("studyPlans.ui.estimated-model-cost-usd-var.dfefd61f", {var0: estimatedCost.toLocaleString(undefined, { maximumSignificantDigits: 5 })})
      : translateRecentFeature("studyPlans.ui.model-cost-unavailable.ba10e86d");

  return (
    <section aria-label={translateRecentFeature("studyPlans.ui.generation-details.df0b997d")} className="space-y-4 rounded-xl border border-border bg-surface-container-low p-4 text-sm">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">{translateRecentFeature("studyPlans.ui.model-and-location.7b9cb737")}</dt>
          <dd className="mt-1 break-words">{providerName}{model && model.name !== model.id ? ` · ${model.name}` : ''}</dd>
          <dd className="break-all text-muted-foreground">{model?.id ?? translateRecentFeature("i18nAudit.ui.exact-model-id-unavailable.332c0f44")}</dd>
          <dd className="text-muted-foreground">{translateRecentFeature(localityNames[locality])}</dd>
        </div>
        <div>
          <dt className="font-medium">{translateRecentFeature("studyPlans.ui.execution-budget.4e83873a")}</dt>
          <dd className="mt-1">{translateRecentFeature("studyPlans.ui.up-to-var0-model-calls.16e046e5", {var0: preflight.maximumModelCalls})}</dd>
          <dd className="text-muted-foreground">{cost}</dd>
        </div>
      </dl>
      <div className="space-y-1">
        <p>{preflight.sendsSourceOffDevice
          ? translateRecentFeature("i18nAudit.ui.var0-are-sent-to-var1.71e4bfcf", {var0: payload, var1: providerName})
          : translateRecentFeature("i18nAudit.ui.var0-stay-on-this-device-dur.3bee083e", {var0: payload})}</p>
        {embedding && (
          <p>{remoteEmbedding
            ? translateRecentFeature("i18nAudit.ui.your-goal-and-in-scope-conce.580e10d7", {var0: embedding.provider, var1: embedding.maximumQueries})
            : translateRecentFeature("studyPlans.ui.retrieval-queries-stay-on-th.1a54e848")}</p>
        )}
      </div>
      {embedding && (
        <div>
          <p>{translateRecentFeature("studyPlans.ui.var0-selected-documents.3805dbe0", {var0: preflight.documentIds.length})}{indexedSourceCount != null
            ? translateRecentFeature("i18nAudit.ui.var0-with-indexed-chunks.74a2c65c", {var0: indexedSourceCount}) : (" " + translateRecentFeature("studyPlans.ui.index-coverage-unverified.a56c7220"))}</p>
          <p className="text-muted-foreground">{translateRecentFeature("studyPlans.ui.retrieval-mode-is-determined.8a1e72ef")}</p>
        </div>
      )}
      <details className="text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">{translateRecentFeature("studyPlans.ui.model-retrieval-and-pricing-.7ff2744f")}</summary>
        <div className="mt-2 space-y-1">
          {model && <p className="break-all">{translateRecentFeature("studyPlans.ui.endpoint-var0.b0041b90", {var0: model.endpointOrigin})}</p>}
          {preflight.modelClass && <p>{preflight.reasoningFallback
            ? translateRecentFeature("studyPlans.ui.full-model-prompt-on-the-sel.1a0e03fb")
            : translateRecentFeature("i18nAudit.ui.task-class-var0.4a4dc45a", {var0: preflight.modelClass})}{model && (model.reasoningMetadata === true
              ? (" " + translateRecentFeature("studyPlans.ui.the-model-catalog-advertises.c7019939"))
              : (" " + translateRecentFeature("studyPlans.ui.reasoning-capability-is-unve.4034dd84")))}</p>}
          {embedding && <p className="break-words">{translateRecentFeature("studyPlans.ui.embedding-backend-var0-var1.ed998a39", {var0: embedding.provider, var1: embedding.model})}{embeddingDestination && typeof embeddingDestination === 'object' && ` · ${translateRecentFeature(localityNames[embeddingDestination.locality])}`}</p>}
          {estimate && (
            <>
              <p>{translateRecentFeature("studyPlans.ui.up-to-var0-planned-stages-wi.b18f877f", {var0: estimate.modelSteps})}</p>
              <p>{translateRecentFeature("studyPlans.ui.planning-estimate-for-first-.42d46c36", {var0: estimate.inputTokens.toLocaleString(), var1: estimate.outputTokens.toLocaleString()})}</p>
              {estimate.inputPrice != null && <p>{translateRecentFeature("studyPlans.ui.configured-input-price-var0-.90c1d278", {var0: estimate.inputPrice})}</p>}
              {estimate.outputPrice != null && <p>{translateRecentFeature("studyPlans.ui.configured-output-price-var0.658b8e35", {var0: estimate.outputPrice})}</p>}
            </>
          )}
          {remoteEmbedding && <p>{translateRecentFeature("studyPlans.ui.embedding-charges-are-separa.591d237e")}</p>}
        </div>
      </details>
      {offDevice && onCloudDisclosureChange && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={cloudDisclosureAccepted} disabled={disabled}
            onChange={(event) => onCloudDisclosureChange(event.target.checked)} />
          <span>{translateRecentFeature("studyPlans.ui.i-approve-the-off-device-dat.c60b721c")}</span>
        </label>
      )}
      {preflight.billable && onCostConsentChange && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={costConsentAccepted} disabled={disabled}
            onChange={(event) => onCostConsentChange(event.target.checked)} />
          <span>{translateRecentFeature("studyPlans.ui.i-authorize-the-disclosed-ex.75872582")}</span>
        </label>
      )}
    </section>
  );
}

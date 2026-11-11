import type { StudyAiPreflight } from '../../lib/study-plans/generation/types';

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
  device: 'On-device',
  loopback: 'Localhost',
  lan: 'Local network',
  remote: 'Cloud',
  unknown: 'Location unknown',
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
  if (!preflight) return null;
  const { model, estimate, embedding, embeddingDestination, generationDestination } = preflight;
  const locality = typeof generationDestination === 'object' ? generationDestination.locality : 'unknown';
  const remoteEmbedding = typeof embeddingDestination === 'object' && embeddingDestination?.sendsOffDevice;
  const offDevice = preflight.sendsSourceOffDevice || remoteEmbedding;
  const providerName = model?.provider ?? preflight.providerId;
  const payload = purpose === 'rubric' ? 'Submitted written answers, committed rubrics, and their source excerpts'
    : purpose === 'assessment' ? 'Assessment topics, question requirements, and selected passages'
    : 'Your learning goal, selected passages, and generated topics';
  const estimatedCost = estimate?.costUsd;
  const priced = estimatedCost != null && Number.isFinite(estimatedCost);
  const cost = !preflight.billable
    ? 'No configured API charges'
    : priced ? `Estimated model cost USD ${estimatedCost.toLocaleString(undefined, { maximumSignificantDigits: 5 })}`
      : 'Model cost unavailable';

  return (
    <section aria-label="Generation details" className="space-y-4 rounded-xl border border-border bg-surface-container-low p-4 text-sm">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">Model and location</dt>
          <dd className="mt-1 break-words">{providerName}{model && model.name !== model.id ? ` · ${model.name}` : ''}</dd>
          <dd className="break-all text-muted-foreground">{model?.id ?? 'Exact model ID unavailable'}</dd>
          <dd className="text-muted-foreground">{localityNames[locality]}</dd>
        </div>
        <div>
          <dt className="font-medium">Execution budget</dt>
          <dd className="mt-1">Up to {preflight.maximumModelCalls} model calls</dd>
          <dd className="text-muted-foreground">{cost}</dd>
        </div>
      </dl>
      <div className="space-y-1">
        <p>{preflight.sendsSourceOffDevice
          ? `${payload} are sent to ${providerName}.`
          : `${payload} stay on this device during model processing.`}</p>
        {embedding && (
          <p>{remoteEmbedding
            ? `Your goal and in-scope concept names may be sent to ${embedding.provider} for up to ${embedding.maximumQueries} embedding queries.`
            : 'Retrieval queries stay on this device.'}</p>
        )}
      </div>
      {embedding && (
        <div>
          <p>{preflight.documentIds.length} selected documents{indexedSourceCount != null
            ? ` · ${indexedSourceCount} with indexed chunks` : ' · index coverage unverified'}</p>
          <p className="text-muted-foreground">Retrieval mode is determined after the search.</p>
        </div>
      )}
      <details className="text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Model, retrieval, and pricing details</summary>
        <div className="mt-2 space-y-1">
          {model && <p className="break-all">Endpoint {model.endpointOrigin}</p>}
          {preflight.modelClass && <p>{preflight.reasoningFallback
            ? 'Full-model prompt on the selected model.'
            : `Task class ${preflight.modelClass}.`}{model && (model.reasoningMetadata === true
              ? ' The model catalog advertises reasoning.'
              : ' Reasoning capability is unverified for this route.')}</p>}
          {embedding && <p className="break-words">Embedding backend {embedding.provider} · {embedding.model}{embeddingDestination && typeof embeddingDestination === 'object' && ` · ${localityNames[embeddingDestination.locality]}`}</p>}
          {estimate && (
            <>
              <p>Up to {estimate.modelSteps} planned stages, with one correction call reserved per stage.</p>
              <p>Planning estimate for first attempts · {estimate.inputTokens.toLocaleString()} input tokens · {estimate.outputTokens.toLocaleString()} output tokens.</p>
              {estimate.inputPrice != null && <p>Configured input price ${estimate.inputPrice} per 1,000 tokens.</p>}
              {estimate.outputPrice != null && <p>Configured output price ${estimate.outputPrice} per 1,000 tokens.</p>}
            </>
          )}
          {remoteEmbedding && <p>Embedding charges are separate from the model estimate and may be unavailable.</p>}
        </div>
      </details>
      {offDevice && onCloudDisclosureChange && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={cloudDisclosureAccepted} disabled={disabled}
            onChange={(event) => onCloudDisclosureChange(event.target.checked)} />
          <span>I approve the off-device data transfers shown above.</span>
        </label>
      )}
      {preflight.billable && onCostConsentChange && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={costConsentAccepted} disabled={disabled}
            onChange={(event) => onCostConsentChange(event.target.checked)} />
          <span>I authorize the disclosed execution budget and applicable provider charges.</span>
        </label>
      )}
    </section>
  );
}

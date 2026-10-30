import { budgetScopedBodies, scopedBodyTokenBudget } from "../../../utils/scopedContextBudget";
import type { SectionSourceReference } from "../../../utils/sectionIndex";
/**
 * Learning Agent adapter for the existing Assistant (change
 * `complete-ai-learning-agent-integration`, tasks 1.1/1.2/1.4 + 2.1).
 *
 * This module is the single boundary between the Assistant's conversation and
 * the constrained `runAgentLoop`. It owns:
 *
 *  1. the FROZEN RUN ENVELOPE built at submit (conversation + immutable
 *     source set + selection + section/chapter context + owner revision);
 *  2. scope resolution (section/document/library/papers) with honest
 *     "select a section" failures instead of pretending a whole chapter was
 *     read;
 *  3. destination preflight (F0 classifier for generation AND embeddings,
 *     existing disclosure/billing consent, lexical degradation when an
 *     embedding destination is not authorized);
 *  4. the single hard run deadline (≤60 s) linked to Stop, conversation
 *     switch, source change, flag-off and unmount;
 *  5. a frozen `AgentEnvironment` whose reads never consult the subsequently
 *     active global document.
 *
 * No persistence and no writes happen here. Proposals are drafts until the
 * existing approval handoff saves them.
 */

import { getRecentExtractsBounded } from "../../../api/extract-review";
import { getImageAssetById } from "../../../api/image-registry";
import {
  getDueLearningItemsBounded,
  searchLearningItemsBounded,
} from "../../../api/learning-items";
import { getReviewStatistics } from "../../../api/algorithm";
import { retrieveFromLibrary, type EmbeddingConfig } from "../../../api/ai-learning";
import { useDocumentStore } from "../../../stores/documentStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { recordFeatureObservation } from "../diagnostics";
import {
  classifyCloudDestination,
  classifyEmbeddingDestination,
  classifyNativeDestination,
  type DestinationClassification,
} from "../features/destinations";
import {
  buildFeatureDependencyContext,
  computeDependencyRevision,
  getFeatureDependencyContext,
} from "../features/probe";
import { evaluateFeatureReadiness } from "../features/registry";
import type {
  FeatureReadiness,
  FeatureStatus,
  ProviderClass,
  RecoveryTargetId,
} from "../features/types";
import { getActiveCloudConfig } from "../providers/cloudProvider";
import { resolveEmbeddingConfigForRag } from "../../../components/assistant/ragConfig";
import { ensureCloudAiDisclosure } from "../../privacy/cloudAiDisclosure";
import {
  APPLE_CORE_AI_PROVIDER_ID,
  APPLE_FOUNDATION_PROVIDER_ID,
  FOUNDRY_LOCAL_PROVIDER_ID,
  ON_DEVICE_PROVIDER_ID,
  WINDOWS_SYSTEM_PROVIDER_ID,
} from "../providers";
import type { AIProvider } from "../providers/types";
import { resolveAiPath } from "../provider";
import { resolveTaskRoute } from "../tasks/router";
import { enforceAssistantPrivacyAndConsent } from "./privacyGate";
import { createAgentDeadline, type AgentRunDeadline } from "../agent/deadline";
import { AGENT_MAX_OUTPUT_TOKENS, AGENT_TRANSCRIPT_CHAR_BUDGET, AGENT_RUNNER_TASK_ID, agentRunnerTask, runAgentLoop, type AgentRunEvent, type AgentRunGuardViolation, type AgentRunResult } from "../agent/loop";
import { mapLearningItemToAgentCard } from "../agent/sessionContext";
import type {
  AgentCardQuery,
  AgentDocumentSummary,
  AgentEnvironment,
  AgentSectionContext,
  AgentSelectionSummary,
} from "../agent/tools/types";
import type {
  SelectionSnapshot,
  SourceLocator,
  SourceReference,
} from "./conversations/types";
import { CONVERSATION_RECORD_VERSION } from "./conversations/types";

export const LEARNING_AGENT_FEATURE_ID = "learning-agent" as const;
export const LEARNING_AGENT_MAX_RUN_MS = 60_000;

/* ------------------------------------------------------------------------- */
/* Scope input + frozen envelope                                             */
/* ------------------------------------------------------------------------- */

export type LearningAgentScopeKind = "section" | "document" | "library" | "papers";

export interface LearningAgentDocumentInput {
  id: string;
  title: string;
  contentVersion?: string;
  locator?: SourceLocator;
  fileType?: string;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
}

export interface LearningAgentSectionInput {
  source?: SectionSourceReference;
  bodies?: readonly { label: string; text: string; selection?: boolean }[];
  documentId: string;
  title?: string;
  text: string;
  locator?: SourceLocator;
  /** Section node id (bounded to the frozen document). */
  sectionId?: string;
}

export interface LearningAgentSubmitInput {
  conversationId: string;
  /** Assistant request epoch / conversation revision frozen at submit. */
  ownerRevision: number;
  intent: string;
  scope: LearningAgentScopeKind;
  /** Explicitly attached/authorized documents (active reader + picked papers). */
  documents: LearningAgentDocumentInput[];
  primaryDocumentId?: string;
  selection?: SelectionSnapshot;
  section?: LearningAgentSectionInput;
  /** Pre-built attachment references (tests/entry intents); optional. */
  attachments?: SourceReference[];
}

export interface FrozenLearningAgentRun {
  readonly runId: string;
  readonly conversationId: string;
  readonly ownerRevision: number;
  readonly intent: string;
  readonly scope: LearningAgentScopeKind;
  /** Immutable authorized source set. */
  readonly sources: SourceReference[];
  readonly selection?: SelectionSnapshot;
  readonly section?: LearningAgentSectionInput;
  /** Stable hash of the frozen identities/revisions. */
  readonly sourceRevision: string;
  /** Document ids retrieval/tools are restricted to (empty = whole library). */
  readonly retrievalDocumentIds: string[];
  readonly primaryDocumentId?: string;
  /** Readiness/config revision the run was authorized under. */
  readonly capabilityRevision: string;
  readonly generation: {
    providerId: string;
    kind: "ondevice" | "cloud";
    destination: DestinationClassification;
  };
  readonly embedding?: {
    destination: DestinationClassification;
    config?: EmbeddingConfig;
    /** False when the run degrades to lexical retrieval. */
    authorized: boolean;
    limitation?: string;
  };
  readonly createdAt: number;
}

export type LearningAgentScopeFailureReason =
  | "needs-section"
  | "needs-selection"
  | "no-source"
  | "source-excluded";

export interface LearningAgentScopeFailure {
  ok: false;
  reason: LearningAgentScopeFailureReason;
  message: string;
}

export interface LearningAgentScopeReady {
  ok: true;
  run: FrozenLearningAgentRun;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeRunId(conversationId: string): string {
  return `lagent-${stableHash(`${conversationId}:${Date.now()}:${Math.random()}`)}`;
}

function sourceReferenceForDocument(
  document: LearningAgentDocumentInput,
  primary: boolean
): SourceReference {
  return {
    attachmentId: `doc:${document.id}`,
    kind: "document",
    libraryId: document.id,
    title: document.title,
    sourceType: document.fileType,
    contentVersion: document.contentVersion,
    locator: document.locator,
    origin: primary ? "active-view" : "picker",
    role: primary ? "required" : "optional",
  };
}

function selectionSourceReference(
  selection: SelectionSnapshot
): SourceReference | null {
  if (!selection.documentId) return null;
  return {
    attachmentId: `selection:${selection.documentId}`,
    kind: "selection",
    libraryId: selection.documentId,
    title: selection.title ?? "Selected passage",
    locator: selection.locator,
    origin: "selection",
    role: "required",
  };
}

/**
 * Freeze the conversation/source scope at submit.
 *
 * The result never reads global reader state again: callers must pass the
 * documents, selection and section captured at submit. A chapter request that
 * cannot identify a bounded section fails typed (`needs-section`) so the
 * Assistant can ask for a selection instead of silently analyzing everything.
 */
export function resolveLearningAgentScope(
  input: LearningAgentSubmitInput,
  options: { capabilityRevision?: string } = {}
): LearningAgentScopeReady | LearningAgentScopeFailure {
  const documents = input.documents.filter((document) => !document.isAiExcluded);
  if (input.documents.some((document) => document.isAiExcluded) && documents.length === 0) {
    return {
      ok: false,
      reason: "source-excluded",
      message:
        "The attached source is excluded from AI processing. Enable AI for it in the document settings first.",
    };
  }

  if (input.scope === "section" || input.scope === "document") {
    if (documents.length === 0 && !input.selection?.originalText?.trim()) {
      return {
        ok: false,
        reason: "needs-selection",
        message:
          "Attach or open a document (or select a passage) before asking the Learning Agent for cards.",
      };
    }
  }

  if (input.scope === "section" && !input.section) {
    if (input.selection?.originalText?.trim()) {
      // An explicit selection is a bounded section: freeze it as one.
    } else {
      return {
        ok: false,
        reason: "needs-section",
        message:
          "I can’t identify a chapter or section from the frozen attachments. Select a section or passage, then ask again — nothing was run.",
      };
    }
  }

  if (input.scope === "papers" && documents.length === 0) {
    return {
      ok: false,
      reason: "no-source",
      message:
        "Attach at least one paper/document to run a multi-paper request. Nothing was run.",
    };
  }

  const primaryId = input.primaryDocumentId ?? documents[0]?.id;
  const sources: SourceReference[] = documents.map((document) =>
    sourceReferenceForDocument(document, document.id === primaryId)
  );
  const selection = input.selection;
  if (selection) {
    const reference = selectionSourceReference(selection);
    if (reference) sources.push(reference);
  }

  const section: LearningAgentSectionInput | undefined = (() => {
    const raw =
      input.section ??
      (input.scope === "section" && selection?.originalText?.trim()
        ? {
            documentId: selection.documentId ?? primaryId ?? "",
            title: selection.title,
            text: selection.editedText ?? selection.originalText,
            locator: selection.locator,
          }
        : undefined);
    if (!raw) return undefined;
    // Freeze the canonical scope here; allocate against the chosen provider
    // after preflight, preserving all selected bodies.
    return { ...raw };
  })();
  if (input.scope === "section" && (!section || !section.text.trim())) {
    return {
      ok: false,
      reason: "needs-section",
      message:
        "The selected section has no readable text in the frozen scope. Select a section or passage again — nothing was run.",
    };
  }

  const sourceRevision = stableHash(
    sources
      .map(
        (source) =>
          `${source.libraryId ?? source.ephemeral?.ownerToken ?? source.attachmentId}:${
            source.contentVersion ?? ""
          }:${source.removedAt ?? ""}`
      )
      .join("|") + (section ? `:sec:${stableHash(section.text)}` : "")
  );

  return {
    ok: true,
    run: {
      runId: makeRunId(input.conversationId),
      conversationId: input.conversationId,
      ownerRevision: input.ownerRevision,
      intent: input.intent,
      scope: input.scope,
      sources,
      selection,
      section,
      sourceRevision,
      retrievalDocumentIds: documents.map((document) => document.id),
      primaryDocumentId: primaryId,
      capabilityRevision: options.capabilityRevision ?? "unprobed",
      generation: {
        providerId: "unresolved",
        kind: "ondevice",
        destination: classifyNativeDestination("unknown"),
      },
      createdAt: Date.now(),
    },
  };
}

/**
 * Deterministic scope inference for the composer presets. Explicit scope input
 * always wins; this only translates the user's words into the same envelope.
 */
export function inferLearningAgentScope(
  intent: string,
  options: {
    explicit?: LearningAgentScopeKind;
    documentCount: number;
    hasSection: boolean;
    hasSelection: boolean;
  }
): LearningAgentScopeKind {
  if (options.explicit) return options.explicit;
  if (options.documentCount > 1) return "papers";
  if (/\b(chapter|section|this part|these pages)\b/i.test(intent)) {
    return options.hasSection || options.hasSelection ? "section" : "section";
  }
  if (/\b(library|across (my|the) (library|notes)|related material)\b/i.test(intent)) {
    return "library";
  }
  if (options.hasSection || options.hasSelection) return "section";
  if (options.documentCount > 0) return "document";
  return "library";
}

/* ------------------------------------------------------------------------- */
/* Destination preflight                                                     */
/* ------------------------------------------------------------------------- */

export type LearningAgentPreflightCode =
  | "feature-disabled"
  | "feature-checking"
  | "no-provider"
  | "no-model"
  | "privacy-denied"
  | "disclosure-required"
  | "billing-required"
  | "destination-unknown";

export interface LearningAgentPreflightBlocker {
  code: LearningAgentPreflightCode;
  /** Safe, user-facing explanation (no endpoint/credential content). */
  message: string;
  recovery?: RecoveryTargetId;
}

export interface LearningAgentPreflight {
  ok: boolean;
  status: FeatureStatus;
  capabilityRevision: string;
  readiness?: FeatureReadiness;
  provider?: AIProvider;
  kind?: "ondevice" | "cloud";
  generation?: DestinationClassification;
  providerId?: string;
  embedding?: {
    destination: DestinationClassification;
    config?: EmbeddingConfig;
    authorized: boolean;
    limitation?: string;
  };
  blockers: LearningAgentPreflightBlocker[];
  limitations: string[];
  /** True once the route differs from a previously failed native attempt. */
  destinationChangeRequiresConsent: boolean;
}

export interface LearningAgentPreflightOptions {
  /** Documents/sources whose local-only/exclusion policy must be enforced. */
  documents?: Array<{
    id: string;
    title?: string;
    isAiExcluded?: boolean;
    isLocalOnly?: boolean;
  }>;
  /** Prompt for the existing disclosure surface (default true). */
  promptDisclosure?: boolean;
  /**
   * The caller is offering an explicit retry after a native failure. A
   * destination change is never automatic; this only records that the user
   * has already chosen the retry.
   */
  explicitDestinationRetry?: boolean;
  /**
   * Force the generation route for an EXPLICIT user retry (e.g. "Retry on
   * cloud"). Never set this for the first attempt or an automatic path.
   */
  forceKind?: "ondevice" | "cloud";
  /** Prompt the existing paid-consent surface for a billable run (default true). */
  requestBillingConsent?: boolean;
}

function nativeProviderClass(providerId: string): ProviderClass {
  switch (providerId) {
    case ON_DEVICE_PROVIDER_ID:
      return "android-nano";
    case APPLE_FOUNDATION_PROVIDER_ID:
    case APPLE_CORE_AI_PROVIDER_ID:
      return "apple-native";
    case WINDOWS_SYSTEM_PROVIDER_ID:
      return "windows-system";
    case FOUNDRY_LOCAL_PROVIDER_ID:
      return "foundry-local";
    default:
      return "unknown";
  }
}

function hasEmbeddingKey(provider: string): boolean {
  const match = useLLMProvidersStore
    .getState()
    .providers.find(
      (candidate) =>
        candidate.provider === provider && (candidate.apiKey ?? "").trim().length > 0
    );
  return Boolean(match);
}

/**
 * Resolve generation AND embedding destinations before any retrieval or
 * generation, reusing F0's classifier and the existing disclosure/billing
 * consent. Off-device/billable generation needs current authorization; an
 * unauthorized embedding destination degrades to lexical retrieval instead of
 * silently sending query/source text anywhere.
 */
export async function preflightLearningAgent(
  options: LearningAgentPreflightOptions = {}
): Promise<LearningAgentPreflight> {
  const settings = useSettingsStore.getState().settings;
  const providers = useLLMProvidersStore.getState().providers;
  const revision = computeDependencyRevision(settings, providers);
  const context = await getFeatureDependencyContext(revision, () =>
    buildFeatureDependencyContext({ checking: false })
  ).catch(() => null);
  const readiness = context
    ? evaluateFeatureReadiness(context).find(
        (row) => row.featureId === LEARNING_AGENT_FEATURE_ID
      )
    : undefined;

  const blockers: LearningAgentPreflightBlocker[] = [];
  const limitations: string[] = [];

  if (!readiness || readiness.status === "checking") {
    blockers.push({
      code: "feature-checking",
      message:
        "Checking AI availability for the Learning Agent. Nothing has been sent to a provider.",
    });
  } else if (!readiness.enabled) {
    blockers.push({
      code: "feature-disabled",
      message:
        "The Learning Agent is turned off. Enable it in Settings → AI → Learning Agent.",
      recovery: "ai.agent",
    });
  } else if (readiness.status !== "ready") {
    const missing = readiness.dependencies.find(
      (dependency) =>
        dependency.state === "missing" ||
        dependency.state === "unsupported" ||
        dependency.state === "unknown"
    );
    const code: LearningAgentPreflightCode =
      missing?.code === "disclosure"
        ? "disclosure-required"
        : missing?.code === "billing"
          ? "billing-required"
          : readiness.status === "unavailable-platform"
            ? "no-model"
            : "no-model";
    blockers.push({
      code,
      message:
        readiness.status === "model-download-required"
          ? "A required on-device model is not downloaded yet. Nothing was sent off-device."
          : readiness.status === "unavailable-platform"
            ? "No supported AI route is available on this platform for the Learning Agent."
            : "No permitted AI generation route is ready. Configure a provider or finish setup first.",
      recovery: missing?.recovery?.targetId ?? "ai.providers",
    });
  }

  const path = await resolveAiPath("prompt");
  if (path === "none") {
    blockers.push({
      code: "no-provider",
      message:
        "No AI provider is configured. Add a provider (or enable on-device AI) before running the Learning Agent.",
      recovery: "ai.providers",
    });
    return {
      ok: false,
      status: readiness?.status ?? "setup-required",
      capabilityRevision: revision,
      readiness,
      blockers,
      limitations,
      destinationChangeRequiresConsent: false,
    };
  }

  const kind: "ondevice" | "cloud" = options.forceKind ?? (path === "ondevice" ? "ondevice" : "cloud");
  const route = await resolveTaskRoute(agentRunnerTask, { kind }).catch(() => null);
  if (!route) {
    blockers.push({
      code: "no-model",
      message:
        kind === "ondevice"
          ? "On-device AI is selected but no model is ready. Open Settings → AI to finish setup."
          : "The configured provider cannot run a structured agent turn. Choose a capable model in Settings → AI.",
      recovery: kind === "ondevice" ? "ai.onDevice" : "ai.providers",
    });
  }

  const provider = route?.provider;
  let generation: DestinationClassification | undefined;
  let providerId: string | undefined;
  if (provider) {
    providerId = provider.id;
    if (kind === "cloud") {
      const config = getActiveCloudConfig();
      if (!config) {
        blockers.push({
          code: "no-provider",
          message: "The configured cloud provider is disabled or missing credentials.",
          recovery: "ai.providers",
        });
      } else {
        generation = classifyCloudDestination({
          provider: config.provider,
          baseUrl: config.baseUrl,
          hasApiKey: (config.apiKey ?? "").trim().length > 0,
        });
      }
    } else {
      generation = classifyNativeDestination(nativeProviderClass(provider.id));
    }
  }

  if (provider && generation) {
    const privacy = await enforceAssistantPrivacyAndConsent({
      documents: options.documents,
      providerId: provider.id,
      model: getActiveCloudConfig()?.model,
      baseUrl: getActiveCloudConfig()?.baseUrl ?? undefined,
      destination: {
        locality: generation.sendsOffDevice ? "remote" : "on-device",
        localityReason: generation.reasonKey,
      },
      strictLocalOnly: settings.ai?.strictLocalOnly === true,
      cloudFallback: false,
      attachingSourceContent: (options.documents?.length ?? 0) > 0,
      isLocalProvider: !generation.sendsOffDevice,
    });
    if (!privacy.allowed) {
      blockers.push({
        code:
          privacy.reason === "paid_cloud_consent_declined"
            ? "billing-required"
            : "privacy-denied",
        message: privacy.message ?? "The selected destination is not authorized for this content.",
        recovery: "ai.providers",
      });
    }
    // Cost authorization for a billable destination uses the existing paid
    // consent surface. It is requested BEFORE any query/source text leaves the
    // device; a denial blocks the run. The persisted fallback flag counts as
    // existing authorization, exactly as elsewhere in the app.
    if (
      generation.requiresCostConsent &&
      settings.ai?.allowCloudFallback !== true &&
      options.requestBillingConsent !== false
    ) {
      const { requestPaidConsent } = await import("../../../utils/aiBillingConsent");
      const granted = await requestPaidConsent({
        kind: "ai-fallback",
        provider: provider.id,
        model: getActiveCloudConfig()?.model,
        label: "Use paid cloud AI for this Learning Agent run",
      });
      if (!granted) {
        blockers.push({
          code: "billing-required",
          message:
            "This run would use a billable cloud provider. Authorize paid cloud AI first; nothing was sent.",
          recovery: "ai.providers",
        });
      }
    }
  }

  // Embedding destination: classified independently from generation, because
  // embeddings can process source text off-device even when generation is local.
  const embeddingSettings = settings.embedding;
  const embeddingDestination = classifyEmbeddingDestination({
    provider: embeddingSettings.provider,
    ollamaBaseUrl: embeddingSettings.ollamaBaseUrl,
    hasApiKey: hasEmbeddingKey(embeddingSettings.provider),
  });
  let embeddingConfig = await resolveEmbeddingConfigForRag().catch(() => undefined);
  let embeddingAuthorized = Boolean(embeddingConfig);
  let embeddingLimitation: string | undefined;
  const hasLocalOnlySource = options.documents?.some((document) => document.isLocalOnly) === true;
  if (embeddingConfig && embeddingDestination.sendsOffDevice) {
    if (settings.ai?.strictLocalOnly === true) {
      embeddingConfig = undefined;
      embeddingAuthorized = false;
      embeddingLimitation = "strict-local-only";
    } else if (hasLocalOnlySource) {
      embeddingConfig = undefined;
      embeddingAuthorized = false;
      embeddingLimitation = "local-only-source";
    } else if (options.promptDisclosure !== false) {
      const disclosed = await ensureCloudAiDisclosure({
        featureClass: "embeddings",
        provider: embeddingSettings.provider,
        isLocal: false,
      });
      if (!disclosed) {
        embeddingConfig = undefined;
        embeddingAuthorized = false;
        embeddingLimitation = "embedding-disclosure-declined";
      }
    } else if (!embeddingDestination.billable) {
      // Keyless remote embedding endpoint still sends text off-device; without
      // an interactive gate (headless callers) use lexical rather than assume.
      embeddingConfig = undefined;
      embeddingAuthorized = false;
      embeddingLimitation = "embedding-disclosure-required";
    }
  }
  if (!embeddingConfig) {
    limitations.push("ai.limitation.lexicalRetrieval");
    embeddingLimitation = embeddingLimitation ?? "lexical-fallback";
  }

  const destinationChangeRequiresConsent =
    options.explicitDestinationRetry === true && kind === "cloud";

  return {
    ok: blockers.length === 0 && Boolean(provider && generation),
    status: readiness?.status ?? (blockers.length ? "setup-required" : "ready"),
    capabilityRevision: revision,
    readiness,
    provider,
    kind,
    generation,
    providerId,
    embedding: {
      destination: embeddingDestination,
      config: embeddingConfig,
      authorized: embeddingAuthorized,
      limitation: embeddingLimitation,
    },
    blockers,
    limitations,
    destinationChangeRequiresConsent,
  };
}

/** Bind a frozen envelope to the authorized execution plan. */
export function bindLearningAgentPlan(
  run: FrozenLearningAgentRun,
  preflight: LearningAgentPreflight
): FrozenLearningAgentRun {
  if (!preflight.provider || !preflight.generation || !preflight.kind) return run;
  return {
    ...run,
    capabilityRevision: preflight.capabilityRevision,
    generation: {
      providerId: preflight.provider.id,
      kind: preflight.kind,
      destination: preflight.generation,
    },
    embedding: preflight.embedding,
  };
}

/* ------------------------------------------------------------------------- */
/* Frozen environment                                                        */
/* ------------------------------------------------------------------------- */

export interface FrozenAgentEnvironmentDeps {
  /** Semantic retrieval; injectable for tests. */
  retrieve?: AgentEnvironment["retrieve"];
  /** Bounded card read; injectable for tests. */
  searchCards?: typeof searchLearningItemsBounded;
  getDueCards?: typeof getDueLearningItemsBounded;
  getExtractsForDocument?: (documentId: string) => Promise<
    Array<{ id: string; document_id: string; content: string; date_modified: string }>
  >;
  getReviewStats?: AgentEnvironment["getReviewStats"];
  getImageAsset?: AgentEnvironment["getImageAsset"];
}

/**
 * Build the injected environment from the frozen snapshot. There is no path
 * from here to `useDocumentStore.currentDocument`: tools see only the
 * submitted sources, selection and section.
 */
export function createFrozenAgentEnvironment(
  run: FrozenLearningAgentRun,
  deps: FrozenAgentEnvironmentDeps = {},
  signal?: AbortSignal
): AgentEnvironment {
  const documentTitles = new Map<string, string>();
  for (const source of run.sources) {
    if (source.libraryId) documentTitles.set(source.libraryId, source.title);
  }
  const primary = run.primaryDocumentId
    ? {
        id: run.primaryDocumentId,
        title: documentTitles.get(run.primaryDocumentId) ?? "Document",
        fileType: "other",
      }
    : undefined;

  const retrieve: AgentEnvironment["retrieve"] =
    deps.retrieve ??
    ((query, options) =>
      retrieveFromLibrary(query, {
        k: options.k,
        filters: {
          ...options.filters,
          sourceTypes: options.filters?.sourceTypes as never,
          documentIds:
            run.retrievalDocumentIds.length > 0
              ? run.retrievalDocumentIds
              : options.filters?.documentIds,
        },
        config: run.embedding?.config,
        includeSpotlight: false,
      }));

  const getRecentExtracts: AgentEnvironment["getRecentExtracts"] = async (limit) => {
    if (run.retrievalDocumentIds.length === 0 && deps.getExtractsForDocument) {
      return [];
    }
    const rows: Array<{
      id: string;
      documentId: string;
      documentTitle?: string;
      content: string;
      dateModified: string;
    }> = [];

    if (deps.getExtractsForDocument) {
      for (const documentId of run.retrievalDocumentIds.slice(0, 4)) {
        const extracts = await deps.getExtractsForDocument(documentId);
        for (const extract of extracts) {
          rows.push({
            id: extract.id,
            documentId: extract.document_id,
            documentTitle: documentTitles.get(extract.document_id),
            content: extract.content,
            dateModified: extract.date_modified,
          });
        }
        if (rows.length >= limit * 2) break;
      }
    } else {
      // One bounded query across the frozen document set (task 1.3).
      const extracts = await getRecentExtractsBounded({
        documentIds:
          run.retrievalDocumentIds.length > 0
            ? run.retrievalDocumentIds
            : undefined,
        limit: Math.min(Math.max(limit, 1), 50),
      });
      for (const extract of extracts) {
        rows.push({
          id: extract.id,
          documentId: extract.document_id,
          documentTitle: documentTitles.get(extract.document_id),
          content: extract.content,
          dateModified: extract.date_modified,
        });
      }
    }

    return rows
      .sort((a, b) => (a.dateModified < b.dateModified ? 1 : -1))
      .slice(0, limit);
  };

  const searchCards = deps.searchCards ?? searchLearningItemsBounded;
  const getCards: AgentEnvironment["getCards"] = async (options?: AgentCardQuery) => {
    const limit = Math.min(options?.limit ?? 20, 50);
    const documentIds = run.retrievalDocumentIds.length
      ? run.retrievalDocumentIds
      : options?.documentIds;
    const items = await searchCards({
      query: options?.text,
      documentIds,
      limit,
    });
    return items.slice(0, limit).map(mapLearningItemToAgentCard);
  };

  const dueReader = deps.getDueCards ?? getDueLearningItemsBounded;
  const getDueCards: AgentEnvironment["getDueCards"] = async (limit = 10) => {
    const due = await dueReader(Math.min(limit * 3, 60));
    return due
      .filter(
        (item) =>
          !item.document_id ||
          run.retrievalDocumentIds.length === 0 ||
          run.retrievalDocumentIds.includes(item.document_id)
      )
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        question: item.question,
        itemType: item.item_type,
        dueDate: item.due_date,
        documentId: item.document_id,
      }));
  };

  return {
    sourceScope: "frozen",
    sourceRevision: run.sourceRevision,
    signal,
    remainingMs: undefined,
    retrieve,
    getDocument: (): AgentDocumentSummary | null => {
      if (!primary) return null;
      const page = run.selection?.locator?.page;
      return {
        id: primary.id,
        title: primary.title,
        fileType: primary.fileType,
        currentPage: page,
      };
    },
    getSelection: (): AgentSelectionSummary | null =>
      run.selection
        ? {
            text: run.selection.editedText ?? run.selection.originalText,
            documentId: run.selection.documentId,
          }
        : null,
    listSources: () =>
      run.sources
        .filter((source) => source.kind === "document" || source.kind === "library")
        .map((source) => ({
          attachmentId: source.attachmentId,
          documentId: source.libraryId,
          title: source.title,
          contentVersion: source.contentVersion,
          role: source.role,
        })),
    getSectionContext: async (): Promise<AgentSectionContext | null> => {
      if (!run.section || !run.section.text.trim()) return null;
      return {
        documentId: run.section.documentId,
        title: run.section.title,
        text: run.section.text,
        locator:
          run.section.locator?.sectionId ??
          run.section.locator?.anchor ??
          (run.section.locator?.page ? `Page ${run.section.locator.page}` : undefined) ??
          run.section.sectionId,
        sourceRevision: run.sourceRevision,
      };
    },
    getRecentExtracts,
    getCards,
    getDueCards,
    getReviewStats:
      deps.getReviewStats ??
      (async () => {
        const stats = await getReviewStatistics();
        return {
          totalItems: stats.total_items,
          totalReviews: stats.total_reviews,
          totalLapses: stats.total_lapses,
          avgInterval: stats.avg_interval,
          retentionEstimate: stats.retention_estimate,
          dueToday: stats.due_today,
          dueWeek: stats.due_week,
          dueMonth: stats.due_month,
        };
      }),
    getImageAsset:
      deps.getImageAsset ??
      (async (assetId) => {
        const asset = await getImageAssetById(assetId);
        return asset ? { id: asset.id, fileName: asset.file_name } : null;
      }),
  };
}

/* ------------------------------------------------------------------------- */
/* Guard: source/destination/flag changes                                    */
/* ------------------------------------------------------------------------- */

export interface LearningAgentGuardOptions {
  /** Re-check documents (defaults to the document store). */
  getDocumentSnapshot?: (documentId: string) => { contentVersion?: string; missing?: boolean } | null;
  /** Active cloud config revision (defaults to the provider store). */
  getProviderSnapshot?: () => { providerId: string; kind: string; baseUrl?: string; model?: string };
  /** Feature flag (defaults to settings). */
  isFeatureEnabled?: () => boolean;
}

/**
 * Build the between-stage guard. A removed/edited source blocks tools and
 * approval; a changed provider endpoint blocks the run rather than silently
 * switching destination.
 */
export function createLearningAgentGuard(
  run: FrozenLearningAgentRun,
  options: LearningAgentGuardOptions = {}
): () => AgentRunGuardViolation | null {
  const documentSnapshot =
    options.getDocumentSnapshot ??
    ((documentId: string) => {
      const document = useDocumentStore
        .getState()
        .documents.find((candidate) => candidate.id === documentId);
      if (!document) return { missing: true };
      return { contentVersion: document.contentHash };
    });
  const providerSnapshot =
    options.getProviderSnapshot ??
    (() => {
      const config = getActiveCloudConfig();
      return {
        providerId: config?.provider ?? "",
        kind: config?.provider ?? "",
        baseUrl: config?.baseUrl,
        model: config?.model,
      };
    });
  const featureEnabled =
    options.isFeatureEnabled ??
    (() => useSettingsStore.getState().settings.features?.aiAgent !== false);

  const frozenProvider = providerSnapshot();

  return () => {
    if (!featureEnabled()) {
      return {
        reason: "feature-disabled",
        explanation:
          "Stopped: the Learning Agent was turned off. Existing drafts are still available.",
      };
    }
    for (const source of run.sources) {
      if (!source.libraryId) continue;
      if (source.removedAt !== undefined) {
        return {
          reason: "source-removed",
          explanation: `Stopped: the source "${source.title}" was removed. Revalidate the attachments and start a new run.`,
        };
      }
      const current = documentSnapshot(source.libraryId);
      if (!current || current.missing) {
        return {
          reason: "source-removed",
          explanation: `Stopped: the source "${source.title}" is no longer available. Reattach it and start a new run.`,
        };
      }
      if (
        source.contentVersion &&
        current.contentVersion &&
        source.contentVersion !== current.contentVersion
      ) {
        return {
          reason: "source-changed",
          explanation: `Stopped: "${source.title}" changed after the run started. Revalidate the source before proposing cards.`,
        };
      }
    }
    if (run.generation.kind === "cloud") {
      const current = providerSnapshot();
      if (
        current.providerId !== frozenProvider.providerId ||
        (current.baseUrl ?? "") !== (frozenProvider.baseUrl ?? "") ||
        (current.model ?? "") !== (frozenProvider.model ?? "")
      ) {
        return {
          reason: "destination-changed",
          explanation:
            "Stopped: the configured AI destination changed during the run. Start a new run to authorize the new destination.",
        };
      }
    }
    return null;
  };
}

/* ------------------------------------------------------------------------- */
/* Run lifecycle                                                             */
/* ------------------------------------------------------------------------- */

export interface LearningAgentRunOptions {
  /** Provider resolved by the preflight (pinned: no silent fallback). */
  provider?: AIProvider;
  /** External lifecycle signal (Stop/conversation/source/flag/unmount). */
  signal?: AbortSignal;
  /** Optional override of the hard budget (tests); never above 60s. */
  wallClockMs?: number;
  onEvent?: (event: AgentRunEvent) => void;
  /** D0 observation identity. */
  capabilityRevision?: string;
  smoke?: boolean;
  /** Injectable environment (tests); defaults to the frozen environment. */
  env?: AgentEnvironment;
  guard?: () => AgentRunGuardViolation | null;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface LearningAgentRunOutcome {
  run: FrozenLearningAgentRun;
  result: AgentRunResult;
  deadline: AgentRunDeadline;
  durationMs: number;
}

function providerKindFor(run: FrozenLearningAgentRun): "ondevice" | "cloud" {
  return run.generation.kind;
}

/**
 * Execute one frozen run through the existing loop under the single hard
 * deadline. The provider is pinned so `runTask` cannot fall back to another
 * destination; a native failure returns a typed error and requires an
 * explicit user retry (which starts a NEW envelope after preflight).
 */
export async function runLearningAgent(
  run: FrozenLearningAgentRun,
  options: LearningAgentRunOptions = {}
): Promise<LearningAgentRunOutcome> {
  const startedAt = Date.now();
  const now = options.now ?? Date.now;
  const wallClockMs = Math.max(
    1,
    Math.min(options.wallClockMs ?? LEARNING_AGENT_MAX_RUN_MS, LEARNING_AGENT_MAX_RUN_MS)
  );
  const deadline = createAgentDeadline({
    signal: options.signal,
    wallClockMs,
    now,
  });
  if (run.section && options.provider) {
    const capabilities = await options.provider.getCapabilities();
    const bodyTokens = scopedBodyTokenBudget({ promptBudgetTokens: Math.min(capabilities.contextTokens - AGENT_MAX_OUTPUT_TOKENS - 256, (AGENT_TRANSCRIPT_CHAR_BUDGET - 2000) / 4), instructions: agentRunnerTask.systemInstruction, userPrompt: run.intent });
    const scoped = budgetScopedBodies(run.section.bodies ?? [{ label: run.section.title ?? "Selected passage", text: run.section.text, selection: true }], bodyTokens);
    run = { ...run, section: { ...run.section, text: scoped.content } };
  }
  const baseEnv = options.env ?? createFrozenAgentEnvironment(run, {}, deadline.signal);
  const capabilityRevision = options.capabilityRevision ?? run.capabilityRevision;

  // Instrument the injected environment's retrieval boundary for D0 without
  // changing any tool or provider behavior.
  const env: AgentEnvironment = {
    ...baseEnv,
    retrieve: async (query, retrieveOptions) => {
      const started = now();
      try {
        const result = await baseEnv.retrieve(query, retrieveOptions);
        recordFeatureObservation({
          featureId: LEARNING_AGENT_FEATURE_ID,
          runId: run.runId,
          stage: "retrieval",
          level: "operational",
          outcome: "success",
          durationMs: Date.now() - started,
          capabilityRevision,
          providerClass: run.generation.destination.providerClass,
        });
        return result;
      } catch (error) {
        recordFeatureObservation({
          featureId: LEARNING_AGENT_FEATURE_ID,
          runId: run.runId,
          stage: "retrieval",
          level: "operational",
          outcome: "failed",
          durationMs: Date.now() - started,
          capabilityRevision,
          providerClass: run.generation.destination.providerClass,
          errorCategory: "RetrievalFailed",
        });
        throw error;
      }
    },
  };

  recordFeatureObservation({
    featureId: LEARNING_AGENT_FEATURE_ID,
    runId: run.runId,
    stage: "preflight",
    level: "operational",
    outcome: "success",
    durationMs: 0,
    capabilityRevision,
    providerClass: run.generation.destination.providerClass,
    modelClass: "full",
  });

  let result: AgentRunResult;
  try {
    result = await runAgentLoop({
      intent: run.intent,
      runId: run.runId,
      env,
      provider: options.provider,
      kind: providerKindFor(run),
      deadline,
      guard: options.guard ?? createLearningAgentGuard(run),
      observation: { capabilityRevision, smoke: options.smoke },
      onEvent: options.onEvent,
      bounds: { wallClockMs },
    });
  } finally {
    // The deadline itself is released here; a late native response is already
    // discarded by the loop's terminal session and the caller's run token.
    setTimeout(() => deadline.dispose(), 0);
  }

  const durationMs = Date.now() - startedAt;
  const outcome =
    result.endReason === "cancelled" || result.endReason === "blocked"
      ? "cancelled"
      : result.endReason === "error" || result.endReason === "invalid-turn"
        ? "failed"
        : "success";
  recordFeatureObservation({
    featureId: LEARNING_AGENT_FEATURE_ID,
    runId: run.runId,
    stage: "generation",
    level: "operational",
    outcome,
    durationMs,
    capabilityRevision,
    providerClass: run.generation.destination.providerClass,
    modelClass: "full",
    errorCategory: result.error?.category,
    recoveryCode: result.endReason,
  });

  return { run, result, deadline, durationMs };
}

/** Record validation/preview/persistence stages from the handoff/UI. */
export function recordLearningAgentStage(input: {
  runId: string;
  stage: "retrieval" | "validation" | "preview" | "persistence" | "navigation";
  outcome: "success" | "failed" | "cancelled" | "skipped";
  capabilityRevision: string;
  durationMs?: number;
  errorCategory?: string;
  recoveryCode?: string;
}): void {
  recordFeatureObservation({
    featureId: LEARNING_AGENT_FEATURE_ID,
    runId: input.runId,
    stage: input.stage,
    level: "operational",
    outcome: input.outcome,
    durationMs: input.durationMs ?? 0,
    capabilityRevision: input.capabilityRevision,
    errorCategory: input.errorCategory,
    recoveryCode: input.recoveryCode,
  });
}

/** The agent runner task id, exported for downstream diagnostics tests. */
export const LEARNING_AGENT_TASK_ID = AGENT_RUNNER_TASK_ID;

/** Record version the conversation artifact must be forward-compatible with. */
export const LEARNING_AGENT_ARTIFACT_RECORD_VERSION = CONVERSATION_RECORD_VERSION;

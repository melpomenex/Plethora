/**
 * AI Learning feature readiness contract (change
 * `harden-ai-learning-feature-initialization`, task 1.1 — program contract F0).
 *
 * One stable vocabulary for every AI Learning feature, its operations and its
 * dependency evidence. Readiness is DERIVED from existing stores/services on
 * every probe; nothing in this module persists a "ready" verdict.
 *
 * The contract is deliberately provider-neutral: callers inject a
 * `FeatureDependencyContext` (see `probe.ts`), which keeps the evaluator pure,
 * deterministic and cheap to unit test without React, Tauri or a network.
 */

/* ------------------------------------------------------------------------- */
/* Feature identity                                                          */
/* ------------------------------------------------------------------------- */

export const FEATURE_IDS = [
  "learn-this",
  "library-rag",
  "socratic-tutor",
  "occlusion-assist",
  "semantic-index",
  "answer-assessment",
  "knowledge-relationships",
  "extract-worthiness",
  "learning-agent",
  "active-recall",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

/** The human-facing grouping used by Settings and AI Diagnostics. */
export interface FeatureMetadata {
  readonly id: FeatureId;
  /** Translation key for the feature name. */
  readonly labelKey: string;
  /** Settings target that explains/reveals the feature. */
  readonly settingsTargetId: string;
}

export const FEATURE_METADATA: Readonly<Record<FeatureId, FeatureMetadata>> = {
  "learn-this": {
    id: "learn-this",
    labelKey: "ai.feature.readiness.learnThis",
    settingsTargetId: "ai.learnThis",
  },
  "library-rag": {
    id: "library-rag",
    labelKey: "ai.feature.readiness.libraryRag",
    settingsTargetId: "ai.libraryRag",
  },
  "socratic-tutor": {
    id: "socratic-tutor",
    labelKey: "ai.feature.readiness.socraticTutor",
    settingsTargetId: "ai.socratic",
  },
  "occlusion-assist": {
    id: "occlusion-assist",
    labelKey: "ai.feature.readiness.occlusionAssist",
    settingsTargetId: "ai.occlusion",
  },
  "semantic-index": {
    id: "semantic-index",
    labelKey: "ai.feature.readiness.semanticIndex",
    settingsTargetId: "ai.semanticIndex",
  },
  "answer-assessment": {
    id: "answer-assessment",
    labelKey: "ai.feature.readiness.answerAssessment",
    settingsTargetId: "ai.answerAssessment",
  },
  "knowledge-relationships": {
    id: "knowledge-relationships",
    labelKey: "ai.feature.readiness.knowledgeRelationships",
    settingsTargetId: "ai.prerequisites",
  },
  "extract-worthiness": {
    id: "extract-worthiness",
    labelKey: "ai.feature.readiness.extractWorthiness",
    settingsTargetId: "ai.extractWorthiness",
  },
  "learning-agent": {
    id: "learning-agent",
    labelKey: "ai.feature.readiness.learningAgent",
    settingsTargetId: "ai.agent",
  },
  "active-recall": {
    id: "active-recall",
    labelKey: "ai.feature.readiness.activeRecall",
    settingsTargetId: "ai.activeRecall",
  },
};

/** Stable operation identifiers. Knowledge exposes both sub-operations. */
export type FeatureOperationId =
  | "analysis"
  | "retrieval"
  | "answer"
  | "tutoring"
  | "ocr"
  | "region-proposals"
  | "indexing"
  | "assessment"
  | "prerequisites"
  | "links"
  | "scoring"
  | "agent-run"
  | "recall-prompts";

/* ------------------------------------------------------------------------- */
/* Readiness types                                                           */
/* ------------------------------------------------------------------------- */

export type FeatureStatus =
  /** A probe is in flight and no current verdict exists. Never rendered green. */
  | "checking"
  | "disabled"
  | "ready"
  | "setup-required"
  | "model-download-required"
  | "indexing"
  | "unavailable-platform"
  | "error";

export type DependencyState =
  | "satisfied"
  | "checking"
  | "missing"
  | "degraded"
  | "unsupported"
  | "unknown";

export type DependencyCode =
  | "feature-enabled"
  | "platform"
  | "generation"
  | "reasoning"
  | "embeddings"
  | "lexical-retrieval"
  | "ocr"
  | "model"
  | "index"
  | "disclosure"
  | "billing"
  | "source"
  | "passage-adapter"
  | "concept-store"
  | "preview"
  | "background-authorization"
  | "recall-mode";

export type RecoveryTargetId =
  | "ai.providers"
  | "ai.onDevice"
  | "ai.learnThis"
  | "ai.libraryRag"
  | "ai.socratic"
  | "ai.occlusion"
  | "ai.semanticIndex"
  | "embeddings.index"
  | "ai.answerAssessment"
  | "ai.prerequisites"
  | "ai.conceptLinks"
  | "ai.extractWorthiness"
  | "ai.agent"
  | "ai.activeRecall"
  | "ai.featureReadiness"
  | "ai.diagnostics";

export interface RecoveryAction {
  /** Stable target id; navigation only — never authorizes setup. */
  readonly targetId: RecoveryTargetId;
  /** Translation key for the action label. */
  readonly labelKey: string;
  /** What the user must do after arriving. */
  readonly kind: "navigate" | "authorize" | "retry";
}

export interface FeatureDependency {
  readonly code: DependencyCode;
  readonly state: DependencyState;
  /**
   * Safe, content-free reason key. Never an endpoint, model path, credential,
   * document title or raw exception message.
   */
  readonly reasonKey?: string;
  /** Typed recovery route where one exists. */
  readonly recovery?: RecoveryAction;
}

export interface FeatureOperationReadiness {
  readonly operationId: FeatureOperationId;
  readonly labelKey: string;
  readonly status: FeatureStatus;
  /** Present when the operation runs but with a disclosed limitation. */
  readonly degradedReasonKey?: string;
  readonly dependencies: readonly FeatureDependency[];
}

/**
 * Normalized provider class for diagnostics. This is a finite vocabulary, not
 * a raw provider/model identifier.
 */
export type ProviderClass =
  | "android-nano"
  | "apple-native"
  | "windows-system"
  | "foundry-local"
  | "ollama-local"
  | "configured-external"
  | "unknown";

export interface SelectedProviderSummary {
  readonly providerClass: ProviderClass;
  /** Coarse capability revision label, safe to export. */
  readonly modelClass?: "fast" | "full" | "reasoning" | "embedding";
  readonly destination: "device" | "loopback" | "lan" | "remote" | "unknown";
}

export interface FeatureReadiness {
  readonly featureId: FeatureId;
  /** The user's persisted preference. */
  readonly enabled: boolean;
  readonly status: FeatureStatus;
  /** Null until the first probe completes (never an optimistic ready). */
  readonly checkedAt: number | null;
  /** True while a probe is in flight; the last checked state is retained. */
  readonly checking: boolean;
  /** Revision of the configuration the verdict was computed from. */
  readonly dependencyRevision: string;
  readonly dependencies: readonly FeatureDependency[];
  readonly operations: readonly FeatureOperationReadiness[];
  readonly provider?: SelectedProviderSummary;
  readonly recoveryActions: readonly RecoveryAction[];
  /** Safe limitation keys (e.g. lexical-retrieval) shown beside the status. */
  readonly limitations: readonly string[];
}

/* ------------------------------------------------------------------------- */
/* Dependency probe context (injected; keeps the evaluator pure)             */
/* ------------------------------------------------------------------------- */

export type CapabilityState =
  | "available"
  | "degraded"
  | "unavailable"
  | "checking"
  | "unknown"
  | "unsupported";

export interface CapabilityProbe<T = undefined> {
  readonly state: CapabilityState;
  /** Safe reason key when not available. */
  readonly reasonKey?: string;
  /** True only when an existing explicit setup control can fix the state. */
  readonly setupAvailable?: boolean;
  /** True when the missing capability is an explicit downloadable model. */
  readonly modelDownloadRequired?: boolean;
  readonly detail?: T;
}

export interface IndexProbeDetail {
  /** `complete` only when every source kind in scope is proven current. */
  readonly completeness: "complete" | "partial" | "unavailable" | "unknown";
  readonly documentsIndexed?: number;
  readonly documentsPending?: number;
}

export type IndexProbeState =
  | "not-started"
  | "queued"
  | "indexing"
  | "paused"
  | "ready"
  | "failed"
  | "unknown";

export interface IndexProbe {
  readonly state: IndexProbeState;
  readonly detail: IndexProbeDetail;
  readonly reasonKey?: string;
}

export interface GenerationProbeDetail {
  readonly providerClass: ProviderClass;
  readonly destination: "device" | "loopback" | "lan" | "remote" | "unknown";
  readonly reasoning: boolean;
  readonly vision: boolean;
}

export interface EmbeddingProbeDetail {
  readonly providerClass: ProviderClass;
  readonly destination: "device" | "loopback" | "lan" | "remote" | "unknown";
  /** True when retrieval can still use the lexical path. */
  readonly lexicalFallback: boolean;
}

export interface RelationshipProbeDetail {
  readonly prerequisites: boolean;
  readonly links: boolean;
}

/**
 * Everything readiness needs, gathered by read-only probes. This is not a
 * store: consumers build it per probe and the evaluator derives verdicts.
 */
export interface FeatureDependencyContext {
  /** Changes whenever provider/settings/model/index configuration changes. */
  readonly revision: string;
  readonly checkedAt: number | null;
  readonly checking: boolean;
  /** Persisted feature preferences (absent = use the existing default). */
  readonly flags: Readonly<Record<string, boolean | undefined>>;
  readonly activeRecallMode: string;
  readonly platform: {
    readonly os: "android" | "ios" | "macos" | "windows" | "linux" | "web" | "unknown";
    readonly mobile: boolean;
  };
  readonly generation: CapabilityProbe<GenerationProbeDetail>;
  readonly embeddings: CapabilityProbe<EmbeddingProbeDetail>;
  readonly ocr: CapabilityProbe;
  readonly index: IndexProbe;
  readonly relationships: CapabilityProbe<RelationshipProbeDetail>;
  readonly passageAdapter: CapabilityProbe;
  readonly source: CapabilityProbe;
  readonly disclosure: CapabilityProbe;
  readonly billing: CapabilityProbe;
}

/* ------------------------------------------------------------------------- */
/* Feature descriptors                                                       */
/* ------------------------------------------------------------------------- */

export interface FeatureFlagsSpec {
  /** Every flag that can independently enable the feature. */
  readonly anyOf: readonly string[];
  /**
   * Flags that must all be true when more than one is required (knowledge
   * keeps prerequisites/links independent, so each operation owns its flag).
   */
  readonly allOf?: readonly string[];
}

export interface OperationSpec {
  readonly operationId: FeatureOperationId;
  readonly labelKey: string;
  readonly flagKeys?: readonly string[];
  readonly requires?: Readonly<{
    generation?: boolean;
    reasoning?: boolean;
    embeddings?: "required" | "optional";
    ocr?: boolean;
    index?: "required" | "optional";
    relationships?: "prerequisites" | "links";
    passageAdapter?: boolean;
    source?: boolean;
    disclosure?: boolean;
    billing?: boolean;
  }>;
}

export interface FeatureDescriptor {
  readonly id: FeatureId;
  readonly flags: FeatureFlagsSpec;
  readonly operations: readonly OperationSpec[];
  /**
   * Features that are structurally unavailable on a platform report
   * `unavailable-platform` unless an operation declares a configured route.
   */
  readonly platformLimited?: boolean;
}

const GENERATION_REQUIRED = { generation: true } as const;

export const FEATURE_DESCRIPTORS: Readonly<Record<FeatureId, FeatureDescriptor>> = {
  "learn-this": {
    id: "learn-this",
    flags: { anyOf: ["aiLearnThis"] },
    operations: [
      { operationId: "analysis", labelKey: "ai.feature.operation.analysis", requires: GENERATION_REQUIRED },
    ],
  },
  "library-rag": {
    id: "library-rag",
    flags: { anyOf: ["aiLibraryRag"] },
    operations: [
      {
        operationId: "retrieval",
        labelKey: "ai.feature.operation.retrieval",
        requires: { embeddings: "optional", index: "required" },
      },
      {
        operationId: "answer",
        labelKey: "ai.feature.operation.answer",
        requires: { ...GENERATION_REQUIRED, embeddings: "optional", index: "required" },
      },
    ],
  },
  "socratic-tutor": {
    id: "socratic-tutor",
    flags: { anyOf: ["aiSocraticTutor"] },
    operations: [
      {
        operationId: "tutoring",
        labelKey: "ai.feature.operation.tutoring",
        requires: { ...GENERATION_REQUIRED, embeddings: "optional", source: true },
      },
    ],
  },
  "occlusion-assist": {
    id: "occlusion-assist",
    flags: { anyOf: ["aiOcclusionAssist"] },
    operations: [
      {
        operationId: "ocr",
        labelKey: "ai.feature.operation.ocr",
        requires: { ocr: true },
      },
      {
        operationId: "region-proposals",
        labelKey: "ai.feature.operation.regionProposals",
        requires: { ...GENERATION_REQUIRED, ocr: true },
      },
    ],
  },
  "semantic-index": {
    id: "semantic-index",
    flags: { anyOf: ["aiSemanticIndex"] },
    operations: [
      {
        operationId: "indexing",
        labelKey: "ai.feature.operation.indexing",
        requires: { embeddings: "required", billing: true },
      },
    ],
  },
  "answer-assessment": {
    id: "answer-assessment",
    flags: { anyOf: ["aiAnswerAssessment"] },
    operations: [
      { operationId: "assessment", labelKey: "ai.feature.operation.assessment", requires: GENERATION_REQUIRED },
    ],
  },
  "knowledge-relationships": {
    id: "knowledge-relationships",
    flags: { anyOf: ["aiPrerequisites", "aiConceptLinks"] },
    operations: [
      {
        operationId: "prerequisites",
        labelKey: "ai.feature.operation.prerequisites",
        flagKeys: ["aiPrerequisites"],
        requires: { ...GENERATION_REQUIRED, embeddings: "optional", index: "required", relationships: "prerequisites" },
      },
      {
        operationId: "links",
        labelKey: "ai.feature.operation.links",
        flagKeys: ["aiConceptLinks"],
        requires: { ...GENERATION_REQUIRED, embeddings: "optional", index: "required", relationships: "links" },
      },
    ],
  },
  "extract-worthiness": {
    id: "extract-worthiness",
    flags: { anyOf: ["aiExtractWorthiness"] },
    operations: [
      {
        operationId: "scoring",
        labelKey: "ai.feature.operation.scoring",
        requires: { ...GENERATION_REQUIRED, passageAdapter: true },
      },
    ],
  },
  "learning-agent": {
    id: "learning-agent",
    flags: { anyOf: ["aiAgent"] },
    operations: [
      {
        operationId: "agent-run",
        labelKey: "ai.feature.operation.agentRun",
        requires: { ...GENERATION_REQUIRED, embeddings: "optional", source: true, disclosure: true },
      },
    ],
  },
  "active-recall": {
    id: "active-recall",
    flags: { anyOf: ["aiActiveRecall"] },
    operations: [
      {
        operationId: "recall-prompts",
        labelKey: "ai.feature.operation.recallPrompts",
        requires: { ...GENERATION_REQUIRED, embeddings: "optional" },
      },
    ],
  },
};

/* ------------------------------------------------------------------------- */
/* Recovery catalog                                                          */
/* ------------------------------------------------------------------------- */

export const RECOVERY_ACTIONS: Readonly<Record<RecoveryTargetId, RecoveryAction>> = {
  "ai.providers": { targetId: "ai.providers", labelKey: "ai.feature.recovery.providers", kind: "navigate" },
  "ai.onDevice": { targetId: "ai.onDevice", labelKey: "ai.feature.recovery.onDevice", kind: "authorize" },
  "ai.learnThis": { targetId: "ai.learnThis", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.libraryRag": { targetId: "ai.libraryRag", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.socratic": { targetId: "ai.socratic", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.occlusion": { targetId: "ai.occlusion", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.semanticIndex": { targetId: "ai.semanticIndex", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "embeddings.index": { targetId: "embeddings.index", labelKey: "ai.feature.recovery.index", kind: "authorize" },
  "ai.answerAssessment": { targetId: "ai.answerAssessment", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.prerequisites": { targetId: "ai.prerequisites", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.conceptLinks": { targetId: "ai.conceptLinks", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.extractWorthiness": { targetId: "ai.extractWorthiness", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.agent": { targetId: "ai.agent", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.activeRecall": { targetId: "ai.activeRecall", labelKey: "ai.feature.recovery.feature", kind: "navigate" },
  "ai.featureReadiness": { targetId: "ai.featureReadiness", labelKey: "ai.feature.recovery.readiness", kind: "navigate" },
  "ai.diagnostics": { targetId: "ai.diagnostics", labelKey: "ai.feature.recovery.diagnostics", kind: "navigate" },
};

/** The recovery route for a dependency code, when one exists. */
export function recoveryFor(code: DependencyCode): RecoveryAction | undefined {
  switch (code) {
    case "generation":
    case "reasoning":
      return RECOVERY_ACTIONS["ai.providers"];
    case "embeddings":
      return RECOVERY_ACTIONS["embeddings.index"];
    case "model":
      return RECOVERY_ACTIONS["ai.onDevice"];
    case "index":
      return RECOVERY_ACTIONS["embeddings.index"];
    case "ocr":
      return RECOVERY_ACTIONS["ai.occlusion"];
    case "billing":
    case "disclosure":
      return RECOVERY_ACTIONS["ai.providers"];
    case "platform":
      return RECOVERY_ACTIONS["ai.onDevice"];
    default:
      return undefined;
  }
}

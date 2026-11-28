/**
 * Extensible Learning Activity Registry, capability negotiation, declarative
 * subject templates, and strict zero-native-execution sandbox boundary.
 */

import type {
  ActivityCapability,
  CompetencyDimension,
  LearningActivityType,
  RuntimeCapabilities,
  SandboxExtensionBoundary,
  SubjectTemplate,
  SubjectTemplateId,
} from "../../types/learningActivity";
import type { LearningEntityKind, LearningEventType } from "../../types/learningEvent";

export type ActivityCategory =
  | "reading"
  | "recall"
  | "practice"
  | "assessment"
  | "synthesis"
  | "remediation";

export type ActivityOfflineBehavior = "full" | "degraded" | "unavailable";

export interface ActivityDefinition {
  activityType: LearningActivityType;
  label: string;
  description: string;
  category: ActivityCategory;
  requiredCapabilities: readonly ActivityCapability[];
  optionalCapabilities: readonly ActivityCapability[];
  evidenceDimensions: readonly CompetencyDimension[];
  offlineBehavior: ActivityOfflineBehavior;
  offlineFallbackReason?: string;
  degradedFallbackReasons?: Partial<Record<ActivityCapability, string>>;
  examIsolationCompatible: boolean;
  defaultExamIsolated: boolean;
  surfaceAdapter: string;
  canonicalEventType: LearningEventType;
  defaultEntityKind: LearningEntityKind;
  defaultEstimatedMinutes: number;
  supportsLocalOnlyDocs: boolean;
  supportsAiExcludedDocs: boolean;
}

export type CapabilityNegotiationStatus = "supported" | "degraded";

export interface CapabilityNegotiationResult {
  activityType: LearningActivityType;
  status: CapabilityNegotiationStatus;
  missingRequired: ActivityCapability[];
  missingOptional: ActivityCapability[];
  fallbackReason: string | null;
  canRunOffline: boolean;
  surfaceAdapter: string;
}

export interface CapabilityNegotiationOptions {
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
}

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  ai: true,
  network: true,
  audio: true,
  speech: true,
  renderer: true,
  external: false,
  verification: true,
  platform: "desktop",
  strictLocalOnly: false,
};

export const SANDBOX_EXTENSION_BOUNDARY: SandboxExtensionBoundary = Object.freeze({
  allowTauriIpc: false,
  allowFilesystem: false,
  allowNetwork: false,
  allowShellExecution: false,
  allowSameOriginIframe: false,
  maxExecutionMs: 2_000,
  maxMemoryMb: 64,
  maxPayloadBytes: 256 * 1024,
  maxMessagesPerSecond: 20,
  redactLocalOnly: true,
  redactAiExcluded: true,
  allowedEventTypes: Object.freeze<LearningEventType[]>([
    "practice_attempted",
    "guided_check_completed",
  ]),
  forbiddenEventTypes: Object.freeze<LearningEventType[]>([
    "assessment_graded",
    "assessment_grade_invalidated",
    "review_committed",
    "review_undone",
  ]),
});

export interface SandboxExtensionEnvelope {
  extensionId: string;
  requestedCapabilities?: string[];
  eventType?: LearningEventType;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
  payload?: Record<string, unknown>;
}

export interface SandboxValidationResult {
  allowed: boolean;
  violations: string[];
}

const FORBIDDEN_SANDBOX_CAPABILITIES = new Set([
  "tauri_ipc",
  "filesystem",
  "fs",
  "shell",
  "exec",
  "process",
  "network",
  "same_origin_iframe",
]);

/**
 * Validates an untrusted extension envelope against the host sandbox boundary.
 */
export function validateSandboxExtensionEnvelope(
  envelope: SandboxExtensionEnvelope,
  boundary: SandboxExtensionBoundary = SANDBOX_EXTENSION_BOUNDARY,
): SandboxValidationResult {
  const violations: string[] = [];

  if (!envelope.extensionId || envelope.extensionId.trim().length === 0) {
    violations.push("Missing extensionId");
  }

  if (boundary.redactLocalOnly && envelope.isLocalOnly) {
    violations.push("Documents marked isLocalOnly cannot be transmitted to sandbox extensions");
  }

  if (boundary.redactAiExcluded && envelope.isAiExcluded) {
    violations.push("Documents marked isAiExcluded cannot be transmitted to sandbox extensions");
  }

  if (envelope.requestedCapabilities) {
    for (const cap of envelope.requestedCapabilities) {
      const normalized = cap.trim().toLowerCase();
      if (FORBIDDEN_SANDBOX_CAPABILITIES.has(normalized)) {
        violations.push(`Forbidden sandbox capability requested: "${cap}"`);
      }
    }
  }

  if (envelope.eventType) {
    if (boundary.forbiddenEventTypes.includes(envelope.eventType)) {
      violations.push(
        `Extension is forbidden from emitting "${envelope.eventType}" events`,
      );
    } else if (!boundary.allowedEventTypes.includes(envelope.eventType)) {
      violations.push(
        `Extension eventType "${envelope.eventType}" is not in the sandbox allowlist`,
      );
    }
  }

  if (envelope.payload !== undefined) {
    const serialized = JSON.stringify(envelope.payload);
    const byteLength = new TextEncoder().encode(serialized).length;
    if (byteLength > boundary.maxPayloadBytes) {
      violations.push(
        `Payload size ${byteLength} bytes exceeds maxPayloadBytes (${boundary.maxPayloadBytes})`,
      );
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export const FIRST_PARTY_ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = Object.freeze([
  {
    activityType: "source_reading",
    label: "Source Reading",
    description: "Incremental reading inside the single canonical DocumentViewerWrapper reader.",
    category: "reading",
    requiredCapabilities: ["renderer"],
    optionalCapabilities: [],
    evidenceDimensions: ["exposure"],
    offlineBehavior: "full",
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "DocumentViewerWrapper",
    canonicalEventType: "reading_completed",
    defaultEntityKind: "document",
    defaultEstimatedMinutes: 12,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "media_consumption",
    label: "Media Consumption",
    description: "Audio/video or podcast consumption with transcript fallback inside the canonical reader host.",
    category: "reading",
    requiredCapabilities: ["renderer"],
    optionalCapabilities: ["audio", "network"],
    evidenceDimensions: ["exposure"],
    offlineBehavior: "degraded",
    offlineFallbackReason: "Network unavailable; falling back to locally cached media or transcript.",
    degradedFallbackReasons: {
      audio: "Audio playback unavailable; falling back to synchronized transcript reading.",
      network: "Offline mode active; streaming media unavailable, using local media/transcript.",
    },
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "DocumentViewerWrapper",
    canonicalEventType: "reading_completed",
    defaultEntityKind: "document",
    defaultEstimatedMinutes: 15,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "flashcard_review",
    label: "Flashcard Review",
    description: "Deterministic local FSRS-7 spaced-repetition recall review.",
    category: "recall",
    requiredCapabilities: [],
    optionalCapabilities: [],
    evidenceDimensions: ["retention"],
    offlineBehavior: "full",
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "ReviewSession",
    canonicalEventType: "review_committed",
    defaultEntityKind: "learning_item",
    defaultEstimatedMinutes: 8,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "extract_review",
    label: "Extract Review",
    description: "Incremental extract refinement, cloze authoring, and key-passage review.",
    category: "synthesis",
    requiredCapabilities: ["renderer"],
    optionalCapabilities: [],
    evidenceDimensions: ["comprehension", "retention"],
    offlineBehavior: "full",
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "DocumentViewerWrapper",
    canonicalEventType: "extract_created",
    defaultEntityKind: "extract",
    defaultEstimatedMinutes: 10,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "guided_reading",
    label: "Guided Reading",
    description: "Structured reading trail segments anchored to the canonical document reader.",
    category: "reading",
    requiredCapabilities: ["renderer"],
    optionalCapabilities: [],
    evidenceDimensions: ["exposure", "comprehension"],
    offlineBehavior: "full",
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "GuidedReadingPanel",
    canonicalEventType: "guided_check_completed",
    defaultEntityKind: "guided_trail",
    defaultEstimatedMinutes: 15,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "comprehension_check",
    label: "Comprehension Check",
    description: "Low-stakes formative check verifying understanding of a passage or concept.",
    category: "assessment",
    requiredCapabilities: ["verification"],
    optionalCapabilities: ["ai"],
    evidenceDimensions: ["comprehension"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; running local item bank and deterministic rubric verification.",
    },
    examIsolationCompatible: true,
    defaultExamIsolated: false,
    surfaceAdapter: "StudyModeWorkspace",
    canonicalEventType: "guided_check_completed",
    defaultEntityKind: "study_plan_node",
    defaultEstimatedMinutes: 6,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "socratic_tutoring",
    label: "Socratic Tutoring",
    description: "Interactive Socratic dialogue that degrades cleanly to structured self-prompting cards without AI.",
    category: "practice",
    requiredCapabilities: [],
    optionalCapabilities: ["ai", "network"],
    evidenceDimensions: ["comprehension", "transfer"],
    offlineBehavior: "degraded",
    offlineFallbackReason: "Offline mode active; using local Socratic self-questioning prompt deck.",
    degradedFallbackReasons: {
      ai: "AI disabled or excluded; falling back to structured Socratic self-prompting rubric cards.",
      network: "Network unavailable; falling back to offline Socratic self-prompting rubric cards.",
    },
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "TutorSheet",
    canonicalEventType: "practice_attempted",
    defaultEntityKind: "concept",
    defaultEstimatedMinutes: 10,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "free_response_practice",
    label: "Free-Response Practice",
    description: "Open-ended written or spoken recall and production with rubric self-check.",
    category: "practice",
    requiredCapabilities: [],
    optionalCapabilities: ["ai", "speech", "audio"],
    evidenceDimensions: ["retention", "application", "transfer"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; using local rubric self-check instead of AI feedback.",
      speech: "Speech input unavailable; falling back to typed free-response input.",
      audio: "Audio unavailable; falling back to text-only prompt display.",
    },
    examIsolationCompatible: true,
    defaultExamIsolated: false,
    surfaceAdapter: "StudyModeWorkspace",
    canonicalEventType: "practice_attempted",
    defaultEntityKind: "concept",
    defaultEstimatedMinutes: 12,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "objective_question_practice",
    label: "Objective Question Practice",
    description: "Deterministic multiple-choice, cloze, and exact-match problem verification.",
    category: "assessment",
    requiredCapabilities: ["verification"],
    optionalCapabilities: [],
    evidenceDimensions: ["comprehension", "application"],
    offlineBehavior: "full",
    examIsolationCompatible: true,
    defaultExamIsolated: false,
    surfaceAdapter: "AttemptRunner",
    canonicalEventType: "assessment_submitted",
    defaultEntityKind: "assessment_attempt",
    defaultEstimatedMinutes: 10,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "structured_problem_solving",
    label: "Structured Problem Solving",
    description: "Multi-step worked examples, proofs, calculations, and read-only code tracing.",
    category: "practice",
    requiredCapabilities: ["renderer", "verification"],
    optionalCapabilities: ["ai"],
    evidenceDimensions: ["application", "transfer"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; using deterministic step-by-step rubric and static verification.",
    },
    examIsolationCompatible: true,
    defaultExamIsolated: false,
    surfaceAdapter: "StudyModeWorkspace",
    canonicalEventType: "practice_attempted",
    defaultEntityKind: "concept",
    defaultEstimatedMinutes: 15,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "rubric_assessment",
    label: "Rubric Assessment",
    description: "Formal exam or graded rubric evaluation executed under strict exam-mode isolation.",
    category: "assessment",
    requiredCapabilities: ["verification"],
    optionalCapabilities: ["ai"],
    evidenceDimensions: ["comprehension", "application", "transfer"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; using local deterministic grading and structured rubric self-scoring.",
    },
    examIsolationCompatible: true,
    defaultExamIsolated: true,
    surfaceAdapter: "AttemptRunner",
    canonicalEventType: "assessment_submitted",
    defaultEntityKind: "assessment_attempt",
    defaultEstimatedMinutes: 25,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "reflection_formulation",
    label: "Reflection & Formulation",
    description: "Free-recall synthesis, concept mapping, and metacognitive reflection.",
    category: "synthesis",
    requiredCapabilities: [],
    optionalCapabilities: ["ai", "speech"],
    evidenceDimensions: ["comprehension", "transfer"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; saving reflection locally with structured synthesis prompts.",
      speech: "Speech dictation unavailable; falling back to keyboard reflection editor.",
    },
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "StudyModeWorkspace",
    canonicalEventType: "practice_attempted",
    defaultEntityKind: "concept",
    defaultEstimatedMinutes: 8,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
  {
    activityType: "targeted_remediation",
    label: "Targeted Remediation",
    description: "Focused review and corrective drills for diagnosed weak concepts or missed exam items.",
    category: "remediation",
    requiredCapabilities: [],
    optionalCapabilities: ["ai"],
    evidenceDimensions: ["comprehension", "retention", "application"],
    offlineBehavior: "full",
    degradedFallbackReasons: {
      ai: "AI unavailable; running deterministic remediation checklist from missed evidence.",
    },
    examIsolationCompatible: false,
    defaultExamIsolated: false,
    surfaceAdapter: "GuidedReadingPanel",
    canonicalEventType: "remediation_completed",
    defaultEntityKind: "remediation",
    defaultEstimatedMinutes: 10,
    supportsLocalOnlyDocs: true,
    supportsAiExcludedDocs: true,
  },
]);

export const SUBJECT_TEMPLATES: readonly SubjectTemplate[] = Object.freeze([
  {
    id: "mathematics",
    name: "Mathematics",
    description: "Balanced proof/problem solving, worked examples, definitions recall, and formative verification.",
    recommendedMix: [
      { activityType: "structured_problem_solving", weight: 0.4 },
      { activityType: "flashcard_review", weight: 0.2 },
      { activityType: "objective_question_practice", weight: 0.2 },
      { activityType: "comprehension_check", weight: 0.1 },
      { activityType: "targeted_remediation", weight: 0.1 },
    ],
    competencyWeights: {
      exposure: 0.1,
      comprehension: 0.25,
      retention: 0.2,
      application: 0.3,
      transfer: 0.15,
    },
    defaultSessionBlueprint: [
      { activityType: "flashcard_review", minutes: 5, label: "Definitions & theorem recall" },
      { activityType: "structured_problem_solving", minutes: 15, label: "Worked example & proof drill" },
      { activityType: "objective_question_practice", minutes: 10, label: "Calculation verification" },
    ],
    promptScaffolds: {
      structured_problem_solving:
        "State known premises, derive each transformation step explicitly, and verify boundary conditions.",
      comprehension_check:
        "Explain why each hypothesis in the theorem is necessary and construct a counterexample if one is dropped.",
      targeted_remediation:
        "Identify the exact step where the derivation diverged and re-solve a parallel variant without hints.",
    },
  },
  {
    id: "computer_science",
    name: "Computer Science",
    description: "Static code tracing, algorithmic reasoning, RFC/spec reading, and architecture synthesis without host shell execution.",
    recommendedMix: [
      { activityType: "structured_problem_solving", weight: 0.35 },
      { activityType: "source_reading", weight: 0.2 },
      { activityType: "reflection_formulation", weight: 0.2 },
      { activityType: "flashcard_review", weight: 0.15 },
      { activityType: "comprehension_check", weight: 0.1 },
    ],
    competencyWeights: {
      exposure: 0.1,
      comprehension: 0.25,
      retention: 0.15,
      application: 0.3,
      transfer: 0.2,
    },
    defaultSessionBlueprint: [
      { activityType: "flashcard_review", minutes: 5, label: "Complexity & invariants recall" },
      { activityType: "source_reading", minutes: 10, label: "Specification / paper reading" },
      { activityType: "structured_problem_solving", minutes: 15, label: "Static state-table tracing & design" },
    ],
    promptScaffolds: {
      structured_problem_solving:
        "Build a step-by-step state trace table, predict output, and state time/space complexity bounds.",
      reflection_formulation:
        "Summarize the core system trade-offs and link invariants to adjacent concepts in the Knowledge Atlas.",
      comprehension_check:
        "Identify edge cases (empty input, concurrency race, overflow) and explain how the invariant holds.",
    },
  },
  {
    id: "philosophy",
    name: "Philosophy",
    description: "Primary-text guided reading, Socratic questioning, argument reconstruction, and extract synthesis.",
    recommendedMix: [
      { activityType: "guided_reading", weight: 0.3 },
      { activityType: "socratic_tutoring", weight: 0.25 },
      { activityType: "reflection_formulation", weight: 0.25 },
      { activityType: "extract_review", weight: 0.1 },
      { activityType: "comprehension_check", weight: 0.1 },
    ],
    competencyWeights: {
      exposure: 0.15,
      comprehension: 0.3,
      retention: 0.1,
      application: 0.15,
      transfer: 0.3,
    },
    defaultSessionBlueprint: [
      { activityType: "guided_reading", minutes: 15, label: "Primary text trail" },
      { activityType: "socratic_tutoring", minutes: 10, label: "Socratic interrogation of premises" },
      { activityType: "reflection_formulation", minutes: 5, label: "Argument & objection map" },
    ],
    promptScaffolds: {
      guided_reading:
        "Isolate the author's central thesis, supporting premises, and implicit definitions in this passage.",
      socratic_tutoring:
        "Test the strongest objection to the claim and evaluate whether the conclusion still follows.",
      reflection_formulation:
        "Reconstruct the argument in standard premise-conclusion form and compare it with a rival position.",
    },
  },
  {
    id: "language_learning",
    name: "Language Learning",
    description: "Active production, listening/media immersion, spaced-repetition vocabulary, and graded reading.",
    recommendedMix: [
      { activityType: "free_response_practice", weight: 0.3 },
      { activityType: "flashcard_review", weight: 0.25 },
      { activityType: "media_consumption", weight: 0.2 },
      { activityType: "source_reading", weight: 0.15 },
      { activityType: "extract_review", weight: 0.1 },
    ],
    competencyWeights: {
      exposure: 0.15,
      comprehension: 0.2,
      retention: 0.25,
      application: 0.25,
      transfer: 0.15,
    },
    defaultSessionBlueprint: [
      { activityType: "flashcard_review", minutes: 10, label: "Vocabulary & sentence recall" },
      { activityType: "media_consumption", minutes: 10, label: "Listening / transcript immersion" },
      { activityType: "free_response_practice", minutes: 10, label: "Dictation, translation & production" },
    ],
    promptScaffolds: {
      free_response_practice:
        "Produce natural target-language sentences using the target grammar pattern, then compare with the rubric.",
      media_consumption:
        "Listen without transcript first for gist, then verify unfamiliar expressions against the transcript.",
      extract_review:
        "Mine high-utility collocations into minimal context sentences for spaced repetition.",
    },
  },
  {
    id: "history_literature",
    name: "History & Literature",
    description: "Source reading, guided thematic trails, synthesis essays, key-date recall, and rubric checks.",
    recommendedMix: [
      { activityType: "source_reading", weight: 0.3 },
      { activityType: "guided_reading", weight: 0.25 },
      { activityType: "reflection_formulation", weight: 0.25 },
      { activityType: "flashcard_review", weight: 0.1 },
      { activityType: "rubric_assessment", weight: 0.1 },
    ],
    competencyWeights: {
      exposure: 0.2,
      comprehension: 0.3,
      retention: 0.15,
      application: 0.1,
      transfer: 0.25,
    },
    defaultSessionBlueprint: [
      { activityType: "source_reading", minutes: 15, label: "Primary/secondary source reading" },
      { activityType: "reflection_formulation", minutes: 10, label: "Timeline & thematic synthesis" },
      { activityType: "flashcard_review", minutes: 5, label: "Key dates, figures & terms" },
    ],
    promptScaffolds: {
      source_reading:
        "Note authorship, historical context, intended audience, and points of tension with other sources.",
      reflection_formulation:
        "Connect causal factors across eras and trace how recurring themes shift across texts.",
      rubric_assessment:
        "Support each interpretive claim with concrete textual or archival evidence.",
    },
  },
]);

export function getSubjectTemplate(id: SubjectTemplateId): SubjectTemplate | undefined {
  return SUBJECT_TEMPLATES.find((template) => template.id === id);
}

export function listSubjectTemplates(): readonly SubjectTemplate[] {
  return SUBJECT_TEMPLATES;
}

function defaultFallbackReason(capability: ActivityCapability): string {
  switch (capability) {
    case "ai":
      return "AI capability unavailable; running deterministic local fallback.";
    case "network":
      return "Network unavailable; running offline fallback.";
    case "audio":
      return "Audio capability unavailable; falling back to text-only mode.";
    case "speech":
      return "Speech input unavailable; falling back to keyboard input.";
    case "renderer":
      return "Rich document renderer unavailable; falling back to plain-text mode.";
    case "external":
      return "External integration unavailable; running local-only mode.";
    case "verification":
      return "Automated verification unavailable; falling back to self-check rubric.";
  }
}

export class LearningActivityRegistry {
  private readonly definitions = new Map<LearningActivityType, ActivityDefinition>();

  register(definition: ActivityDefinition): void {
    this.definitions.set(definition.activityType, Object.freeze({ ...definition }));
  }

  get(activityType: LearningActivityType): ActivityDefinition | undefined {
    return this.definitions.get(activityType);
  }

  has(activityType: LearningActivityType): boolean {
    return this.definitions.has(activityType);
  }

  list(): ActivityDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Deterministically classifies an activity as `supported` or `degraded`
   * against runtime capabilities and privacy constraints, returning a concrete
   * fallback reason whenever AI, network, audio, speech, or other capabilities
   * are unavailable.
   */
  negotiateCapabilities(
    activityType: LearningActivityType,
    runtimeCaps: RuntimeCapabilities,
    options?: CapabilityNegotiationOptions,
  ): CapabilityNegotiationResult {
    const def = this.definitions.get(activityType);
    if (!def) {
      throw new Error(`Unknown learning activity type: "${activityType}"`);
    }

    const effectiveCaps: Record<ActivityCapability, boolean> = {
      ai: Boolean(runtimeCaps.ai) && !runtimeCaps.strictLocalOnly && !options?.isAiExcluded,
      network: Boolean(runtimeCaps.network) && !runtimeCaps.strictLocalOnly && !options?.isLocalOnly,
      audio: Boolean(runtimeCaps.audio),
      speech: Boolean(runtimeCaps.speech),
      renderer: Boolean(runtimeCaps.renderer),
      external: Boolean(runtimeCaps.external) && !runtimeCaps.strictLocalOnly && !options?.isLocalOnly,
      verification: Boolean(runtimeCaps.verification),
    };

    const missingRequired = def.requiredCapabilities.filter((cap) => !effectiveCaps[cap]);
    const missingOptional = def.optionalCapabilities.filter((cap) => !effectiveCaps[cap]);

    const missingAll = [...missingRequired, ...missingOptional];

    if (missingAll.length === 0) {
      return {
        activityType,
        status: "supported",
        missingRequired: [],
        missingOptional: [],
        fallbackReason: null,
        canRunOffline: def.offlineBehavior !== "unavailable",
        surfaceAdapter: def.surfaceAdapter,
      };
    }

    const reasons = missingAll.map(
      (cap) => def.degradedFallbackReasons?.[cap] ?? defaultFallbackReason(cap),
    );
    const uniqueReasons = Array.from(new Set(reasons));

    return {
      activityType,
      status: "degraded",
      missingRequired,
      missingOptional,
      fallbackReason: uniqueReasons.join(" "),
      canRunOffline: def.offlineBehavior !== "unavailable",
      surfaceAdapter: def.surfaceAdapter,
    };
  }
}

export function createDefaultActivityRegistry(): LearningActivityRegistry {
  const registry = new LearningActivityRegistry();
  for (const def of FIRST_PARTY_ACTIVITY_DEFINITIONS) {
    registry.register(def);
  }
  return registry;
}

export const learningActivityRegistry = createDefaultActivityRegistry();

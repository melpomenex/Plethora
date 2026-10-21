/**
 * Session Output Profiles and Explicit Processing Selection (Task 3.7, Design D9).
 *
 * Implements:
 *   - Versioned D9 output defaults per content type
 *   - Meeting / Interview / Seminar defaults: cards OFF
 *   - Lecture defaults: cards ON
 *   - Explicit user opt-in ("Prepare study suggestions"): unset -> no inference
 *   - User overrides for granular output toggles
 *   - Unknown content type fallback to safe "other" profile
 *   - Call and token estimation
 *   - Profile hash calculation for cache invalidation
 */

import { sha256Sync } from "./unitPlanner";

export type KnownProfileType =
  | "lecture"
  | "meeting"
  | "interview"
  | "seminar"
  | "podcast"
  | "voice-note"
  | "other";

export interface ProfileUserOverrides {
  enableCards?: boolean;
  enableExtracts?: boolean;
  enableOutline?: boolean;
  enableConcepts?: boolean;
  enableDecisionsAndActions?: boolean;
}

export interface SessionOutputProfile {
  version: 1;
  profileType: KnownProfileType;
  /** Explicit user authorization to generate AI enrichments. Defaults to false. */
  enrichmentSelected: boolean;
  enableCards: boolean;
  enableExtracts: boolean;
  enableOutline: boolean;
  enableConcepts: boolean;
  enableDecisionsAndActions: boolean;
  userOverrides?: ProfileUserOverrides;
  customInstructions?: string;
  [key: string]: unknown;
}

export const PROFILE_DEFAULTS: Record<
  KnownProfileType,
  {
    enableCards: boolean;
    enableExtracts: boolean;
    enableOutline: boolean;
    enableConcepts: boolean;
    enableDecisionsAndActions: boolean;
  }
> = {
  lecture: {
    enableCards: true,
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
  meeting: {
    enableCards: false, // CARDS OFF BY DEFAULT
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: true,
  },
  interview: {
    enableCards: false, // CARDS OFF BY DEFAULT
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
  seminar: {
    enableCards: false, // CARDS OFF BY DEFAULT
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
  podcast: {
    enableCards: false, // Cards optional
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
  "voice-note": {
    enableCards: false,
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
  other: {
    enableCards: false,
    enableExtracts: true,
    enableOutline: true,
    enableConcepts: true,
    enableDecisionsAndActions: false,
  },
};

export function normalizeProfileType(contentType?: string): KnownProfileType {
  if (!contentType) return "other";
  const clean = contentType.trim().toLowerCase().replace(/[\s_]+/g, "-");

  if (clean === "lecture") return "lecture";
  if (clean === "meeting") return "meeting";
  if (clean === "interview") return "interview";
  if (clean === "seminar" || clean === "presentation") return "seminar";
  if (clean === "podcast") return "podcast";
  if (clean === "voice-note" || clean === "voicenote") return "voice-note";

  return "other";
}

/**
 * Profile-specific guidance injected into the existing section/overview tasks.
 * This tunes *what* a profile asks the model to prioritize; the profile's
 * output toggles remain authoritative for what is persisted or shown.
 */
export const PROFILE_ANALYSIS_GUIDANCE: Record<KnownProfileType, string> = {
  lecture:
    "Prioritize concepts, definitions, explanations, examples and a study-oriented outline. Propose high-value verbatim extracts and card candidates when the session authorizes cards.",
  meeting:
    "Prioritize decisions, action items, questions and commitments, each tied to verbatim evidence. Do not propose cards unless the session explicitly authorizes them.",
  interview:
    "Prioritize the questions asked, concise answers, insights and notable verbatim passages. Keep observations evidence-based and do not propose cards unless explicitly authorized.",
  seminar:
    "Prioritize arguments, supporting evidence, counterpoints and key takeaways. Propose verbatim extracts; do not propose cards unless explicitly authorized.",
  podcast:
    "Prioritize concepts, a narrative outline and high-value verbatim extracts. Cards are optional and only authorized when explicitly selected.",
  "voice-note":
    "Produce a concise outline, key points and short verbatim extract proposals. Cards are optional and only authorized when explicitly selected.",
  other:
    "Produce a concise outline, key points and grounded extract proposals. Cards are optional and only authorized when explicitly selected.",
};

export function getProfileAnalysisGuidance(profile?: string): string {
  return PROFILE_ANALYSIS_GUIDANCE[normalizeProfileType(profile)];
}

/**
 * Get default profile for content type with optional opt-in flag.
 */
export function getDefaultProfile(
  contentType?: string,
  enrichmentSelected = false
): SessionOutputProfile {
  const profileType = normalizeProfileType(contentType);
  const defaults = PROFILE_DEFAULTS[profileType];

  return {
    version: 1,
    profileType,
    enrichmentSelected,
    enableCards: defaults.enableCards,
    enableExtracts: defaults.enableExtracts,
    enableOutline: defaults.enableOutline,
    enableConcepts: defaults.enableConcepts,
    enableDecisionsAndActions: defaults.enableDecisionsAndActions,
  };
}

/**
 * Parse and validate session profile JSON, applying user overrides and fallback defaults.
 */
export function parseSessionProfile(
  profileJson?: string | null,
  contentType?: string
): SessionOutputProfile {
  const profileType = normalizeProfileType(contentType);

  if (!profileJson || !profileJson.trim()) {
    return getDefaultProfile(contentType, false);
  }

  try {
    const raw = JSON.parse(profileJson);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return getDefaultProfile(contentType, false);
    }

    const type = raw.profileType ? normalizeProfileType(String(raw.profileType)) : profileType;
    const typeDefaults = PROFILE_DEFAULTS[type];
    const overrides = typeof raw.userOverrides === "object" && raw.userOverrides !== null ? raw.userOverrides : undefined;

    const enrichmentSelected = Boolean(raw.enrichmentSelected ?? raw.prepareSuggestions);

    const enableCards = overrides?.enableCards ?? (typeof raw.enableCards === "boolean" ? raw.enableCards : typeDefaults.enableCards);
    const enableExtracts = overrides?.enableExtracts ?? (typeof raw.enableExtracts === "boolean" ? raw.enableExtracts : typeDefaults.enableExtracts);
    const enableOutline = overrides?.enableOutline ?? (typeof raw.enableOutline === "boolean" ? raw.enableOutline : typeDefaults.enableOutline);
    const enableConcepts = overrides?.enableConcepts ?? (typeof raw.enableConcepts === "boolean" ? raw.enableConcepts : typeDefaults.enableConcepts);
    const enableDecisionsAndActions = overrides?.enableDecisionsAndActions ?? (typeof raw.enableDecisionsAndActions === "boolean" ? raw.enableDecisionsAndActions : typeDefaults.enableDecisionsAndActions);

    return {
      version: 1,
      profileType: type,
      enrichmentSelected,
      enableCards,
      enableExtracts,
      enableOutline,
      enableConcepts,
      enableDecisionsAndActions,
      userOverrides: overrides,
      customInstructions: typeof raw.customInstructions === "string" ? raw.customInstructions : undefined,
    };
  } catch {
    return getDefaultProfile(contentType, false);
  }
}

/**
 * Serialize a session output profile to JSON.
 */
export function serializeSessionProfile(profile: SessionOutputProfile): string {
  return JSON.stringify(profile);
}

/**
 * Compute stable hash of output configuration for cache invalidation.
 */
export function computeProfileHash(profile: SessionOutputProfile): string {
  const canonical = {
    v: profile.version,
    type: profile.profileType,
    optIn: profile.enrichmentSelected,
    cards: profile.enableCards,
    ext: profile.enableExtracts,
    out: profile.enableOutline,
    con: profile.enableConcepts,
    dec: profile.enableDecisionsAndActions,
    inst: profile.customInstructions || "",
  };
  return sha256Sync(JSON.stringify(canonical));
}

export interface AnalysisScopeEstimate {
  estimatedUnits: number;
  estimatedSectionCalls: number;
  estimatedOverviewCalls: number;
  totalCalls: number;
  maxPotentialCards: number;
  maxPotentialExtracts: number;
  authorized: boolean;
}

/**
 * Calculate expected AI inference calls and draft bounds based on transcript length and profile.
 */
export function estimateAnalysisScope(
  totalTokens: number,
  profile: SessionOutputProfile
): AnalysisScopeEstimate {
  if (!profile.enrichmentSelected) {
    return {
      estimatedUnits: 0,
      estimatedSectionCalls: 0,
      estimatedOverviewCalls: 0,
      totalCalls: 0,
      maxPotentialCards: 0,
      maxPotentialExtracts: 0,
      authorized: false,
    };
  }

  const estimatedUnits = Math.min(64, Math.max(1, Math.ceil(totalTokens / 2000)));
  const estimatedSectionCalls = estimatedUnits;
  const estimatedOverviewCalls = estimatedUnits <= 8 ? 1 : Math.ceil(estimatedUnits / 8) + 1;
  const totalCalls = estimatedSectionCalls + estimatedOverviewCalls;

  const maxPotentialCards = profile.enableCards ? Math.min(40, estimatedUnits * 8) : 0;
  const maxPotentialExtracts = profile.enableExtracts ? Math.min(40, estimatedUnits * 3) : 0;

  return {
    estimatedUnits,
    estimatedSectionCalls,
    estimatedOverviewCalls,
    totalCalls,
    maxPotentialCards,
    maxPotentialExtracts,
    authorized: true,
  };
}

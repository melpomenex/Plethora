import type { ConceptMasterySummary } from "../../../types/learningEvidence";
import type { StudyLearnerPreference } from "../../../types/studyMode";

export interface BoundedLearnerContextPacket {
  subjectKey: string;
  knowledgeLevel: string | null;
  explanationDetail: string;
  vocabularyTolerance: string;
  teachingApproach: string;
  examplePreference: string;
  questionDifficulty: string;
  interests: string[];
  familiarDomains: string[];
  explanationLanguage: string | null;
  observedMastery: Array<{
    conceptId: string;
    level: string;
    unresolvedMisconception: boolean;
  }>;
  truncated: boolean;
}

const MAX_LIST_ITEMS = 5;
const MAX_MASTERIES = 8;
const MAX_TEXT_CHARS = 120;

function sanitizeList(items: string[], maxItems = MAX_LIST_ITEMS): string[] {
  return items
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Resolves subject-specific preference overrides over global preferences and builds
 * a bounded context packet (never sends full libraries or complete learning histories).
 */
export function buildBoundedLearnerContext(input: {
  subjectKey?: string | null;
  preferences: StudyLearnerPreference[];
  masterySummaries?: ConceptMasterySummary[];
}): BoundedLearnerContextPacket {
  const normalizedSubject = input.subjectKey?.trim().toLowerCase() || "__global__";
  const globalPref = input.preferences.find((p) => p.subjectKey === "__global__");
  const subjectPref =
    normalizedSubject !== "__global__"
      ? input.preferences.find((p) => p.subjectKey === normalizedSubject)
      : undefined;

  const effective = subjectPref ?? globalPref;
  const masteries = (input.masterySummaries ?? [])
    .slice(0, MAX_MASTERIES)
    .map((m) => ({
      conceptId: m.conceptId,
      level: m.level,
      unresolvedMisconception: m.level === "needs-attention",
    }));

  return {
    subjectKey: normalizedSubject,
    knowledgeLevel: effective?.knowledgeLevel ?? globalPref?.knowledgeLevel ?? null,
    explanationDetail: effective?.explanationDetail ?? globalPref?.explanationDetail ?? "balanced",
    vocabularyTolerance:
      effective?.vocabularyTolerance ?? globalPref?.vocabularyTolerance ?? "standard",
    teachingApproach: effective?.teachingApproach ?? globalPref?.teachingApproach ?? "balanced",
    examplePreference: effective?.examplePreference ?? globalPref?.examplePreference ?? "everyday",
    questionDifficulty:
      effective?.questionDifficulty ?? globalPref?.questionDifficulty ?? "adaptive",
    interests: sanitizeList(
      effective?.interests.length ? effective.interests : globalPref?.interests ?? []
    ),
    familiarDomains: sanitizeList(
      effective?.familiarDomains.length
        ? effective.familiarDomains
        : globalPref?.familiarDomains ?? []
    ),
    explanationLanguage:
      effective?.explanationLanguage ?? globalPref?.explanationLanguage ?? null,
    observedMastery: masteries,
    truncated: (input.masterySummaries?.length ?? 0) > MAX_MASTERIES,
  };
}

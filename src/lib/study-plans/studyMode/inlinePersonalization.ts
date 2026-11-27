import type { StudyLearnerPreference } from "../../../types/studyMode";

export type InlineAdjustmentId =
  | "simpler"
  | "more_technical"
  | "use_analogy"
  | "show_example"
  | "go_deeper";

export interface InlineAdjustmentOption {
  id: InlineAdjustmentId;
  label: string;
  directive: string;
  preferencePatch: Partial<
    Pick<
      StudyLearnerPreference,
      "explanationDetail" | "vocabularyTolerance" | "teachingApproach" | "examplePreference"
    >
  >;
}

export const INLINE_PERSONALIZATION_CHIPS: InlineAdjustmentOption[] = [
  {
    id: "simpler",
    label: "Simpler",
    directive: "Rewrite using plain, intuitive language and shorter steps while staying accurate.",
    preferencePatch: {
      vocabularyTolerance: "plain",
      explanationDetail: "concise",
    },
  },
  {
    id: "more_technical",
    label: "More technical",
    directive: "Use precise domain terminology, formal definitions, and rigorous phrasing.",
    preferencePatch: {
      vocabularyTolerance: "technical",
      explanationDetail: "detailed",
    },
  },
  {
    id: "use_analogy",
    label: "Use an analogy",
    directive: "Explain using a vivid, clearly labeled illustrative analogy grounded in the source.",
    preferencePatch: {
      examplePreference: "analogy",
      teachingApproach: "example-first",
    },
  },
  {
    id: "show_example",
    label: "Show an example",
    directive: "Lead with a concrete worked example before summarizing the general principle.",
    preferencePatch: {
      teachingApproach: "example-first",
      examplePreference: "everyday",
    },
  },
  {
    id: "go_deeper",
    label: "Go deeper",
    directive: "Explain first-principles mechanisms, edge cases, and deeper implications from the source.",
    preferencePatch: {
      explanationDetail: "detailed",
      teachingApproach: "first-principles",
    },
  },
];

export function getInlineAdjustment(id: InlineAdjustmentId): InlineAdjustmentOption {
  return (
    INLINE_PERSONALIZATION_CHIPS.find((c) => c.id === id) ?? INLINE_PERSONALIZATION_CHIPS[0]
  );
}

export function buildSubjectPreferenceUpdate(input: {
  subjectKey: string;
  adjustmentId: InlineAdjustmentId;
  existingPreferences: StudyLearnerPreference[];
}): {
  subjectKey: string;
  knowledgeLevel: string | null;
  interests: string[];
  familiarDomains: string[];
  explanationDetail: string;
  vocabularyTolerance: string;
  explanationLanguage: string | null;
  teachingApproach: string;
  examplePreference: string;
  questionDifficulty: string;
} {
  const normalizedSubject = input.subjectKey.trim().toLowerCase() || "__global__";
  const existing =
    input.existingPreferences.find((p) => p.subjectKey === normalizedSubject) ??
    input.existingPreferences.find((p) => p.subjectKey === "__global__");
  const adjustment = getInlineAdjustment(input.adjustmentId);

  return {
    subjectKey: normalizedSubject,
    knowledgeLevel: existing?.knowledgeLevel ?? null,
    interests: existing?.interests ?? [],
    familiarDomains: existing?.familiarDomains ?? [],
    explanationDetail: adjustment.preferencePatch.explanationDetail ?? existing?.explanationDetail ?? "balanced",
    vocabularyTolerance:
      adjustment.preferencePatch.vocabularyTolerance ?? existing?.vocabularyTolerance ?? "standard",
    explanationLanguage: existing?.explanationLanguage ?? null,
    teachingApproach:
      adjustment.preferencePatch.teachingApproach ?? existing?.teachingApproach ?? "balanced",
    examplePreference:
      adjustment.preferencePatch.examplePreference ?? existing?.examplePreference ?? "everyday",
    questionDifficulty: existing?.questionDifficulty ?? "adaptive",
  };
}

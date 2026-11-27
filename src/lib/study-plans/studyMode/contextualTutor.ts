import type { StudyTutorContext } from "../../../types/learningEvidence";
import type {
  StudyModeKnowledgeAuthority,
  StudySourceAnchor,
} from "../../../types/studyMode";
import type { BoundedLearnerContextPacket } from "./learnerContext";
import type { PracticeEvaluationResult } from "./practiceEngine";

export interface ContextualTutorPromptOption {
  id: string;
  label: string;
  promptText: string;
  requiresWrongAnswer?: boolean;
}

export const CONTEXTUAL_TUTOR_PROMPTS: ContextualTutorPromptOption[] = [
  {
    id: "explain_simpler",
    label: "Explain more simply",
    promptText: "Explain this concept in simpler, plain language without losing accuracy.",
  },
  {
    id: "concrete_example",
    label: "Give a concrete example",
    promptText: "Give me a concrete, real-world example grounded in this passage.",
  },
  {
    id: "challenge_me",
    label: "Challenge my understanding",
    promptText: "Challenge my understanding with a probing follow-up question.",
  },
  {
    id: "guide_without_reveal",
    label: "Guide me without revealing the answer",
    promptText: "Guide me step by step using Socratic questions without revealing the final answer.",
  },
  {
    id: "missing_prerequisite",
    label: "What prerequisite am I missing?",
    promptText: "What prerequisite concept am I missing to understand this passage fully?",
  },
  {
    id: "connect_known",
    label: "Connect to something I know",
    promptText: "Connect this concept to something familiar from my interests or everyday experience.",
  },
  {
    id: "explain_wrong_answer",
    label: "Explain why my answer was wrong",
    promptText: "Explain why my recent practice answer was wrong and how to correct the misconception.",
    requiresWrongAnswer: true,
  },
];

export interface BuildStudyModeTutorPacketInput {
  documentId: string;
  documentTitle: string;
  passageText: string;
  activeAnchor?: StudySourceAnchor | null;
  activeObjectiveLabel?: string | null;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  recentEvaluations: PracticeEvaluationResult[];
  learnerContext?: BoundedLearnerContextPacket;
  studyPlanContext?: {
    planId: string;
    versionId: string;
    topicId: string;
  };
  selectedPrompt?: string | null;
}

export interface StudyModeTutorPacket {
  topic: string;
  material: string;
  studyContext: StudyTutorContext | null;
}

/**
 * Builds a bounded, source-grounded context packet for Plethora's existing
 * Socratic TutorSheet without duplicating the tutor engine.
 */
export function buildStudyModeTutorPacket(
  input: BuildStudyModeTutorPacketInput
): StudyModeTutorPacket {
  const parts: string[] = [];

  parts.push(`Knowledge Authority: ${input.knowledgeAuthority}`);
  parts.push(`Authorized Source: ${input.documentTitle} (${input.documentId})`);

  if (input.activeObjectiveLabel) {
    parts.push(`Active Learning Objective: ${input.activeObjectiveLabel}`);
  }

  if (input.selectedPrompt) {
    parts.push(`Learner Request: ${input.selectedPrompt}`);
  }

  if (input.activeAnchor?.quote) {
    parts.push(`Focused Anchor Quote: "${input.activeAnchor.quote}"`);
  }

  const recent = input.recentEvaluations.slice(-3);
  if (recent.length > 0) {
    const lines = recent.map(
      (ev, i) =>
        `${i + 1}. Outcome=${ev.outcome} (score ${Math.round(ev.score * 100)}%${
          ev.misconceptionDetected ? `, misconception: ${ev.misconceptionDetected}` : ""
        })`
    );
    parts.push(`Recent Practice Evidence:\n${lines.join("\n")}`);
  }

  const misconceptions = recent
    .map((e) => e.misconceptionDetected)
    .filter((m): m is string => Boolean(m));

  if (input.learnerContext) {
    parts.push(
      `Learner Preferences: level=${input.learnerContext.knowledgeLevel ?? "unspecified"}, detail=${input.learnerContext.explanationDetail}, vocab=${input.learnerContext.vocabularyTolerance}, interests=${input.learnerContext.interests.join(", ") || "none"}`
    );
  }

  parts.push(`Source Passage:\n${input.passageText.slice(0, 2600)}`);

  const studyContext: StudyTutorContext | null = input.studyPlanContext
    ? {
        planId: input.studyPlanContext.planId,
        planVersionId: input.studyPlanContext.versionId,
        nodeId: input.studyPlanContext.topicId,
        conceptId: input.studyPlanContext.topicId,
        gapId: null,
        sourceDocumentIds: [input.documentId],
        sourceRefIds: [input.activeAnchor?.sourceId ?? input.documentId],
        objectives: input.activeObjectiveLabel ? [input.activeObjectiveLabel] : [],
        misconception: misconceptions[0] ?? null,
        evidenceSummary:
          recent.length > 0
            ? `${recent.filter((r) => r.outcome === "understood").length}/${recent.length} recent checks understood`
            : "No recent practice checks yet",
      }
    : null;

  return {
    topic: input.activeObjectiveLabel || input.documentTitle,
    material: parts.join("\n\n"),
    studyContext,
  };
}

import type {
  StudyModeArtifact,
  StudyModeKnowledgeAuthority,
  StudyModeViewTab,
} from "../../../types/studyMode";
import type { PracticeEvaluationResult, PracticeQuestionItem } from "./practiceEngine";

export interface StudyAssistantContextInput {
  documentTitle: string;
  scopeLabel: string;
  scopeExcerpt?: string | null;
  activeTab: StudyModeViewTab;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  activeArtifact?: StudyModeArtifact | null;
  selectedConceptLabel?: string | null;
  activeQuestion?: PracticeQuestionItem | null;
  /** True only AFTER the learner has submitted an answer to activeQuestion. */
  activeQuestionSubmitted?: boolean;
  lastEvaluation?: PracticeEvaluationResult | null;
  studyPlanContext?: {
    planId: string;
    topicId: string;
    segmentId?: string;
  } | null;
}

export interface StudyAssistantContextSummary {
  /** Compact bounded context block safe to attach to Assistant prompts. */
  contextText: string;
  /** Whether answer keys were actively withheld for an unanswered question. */
  withheldAnswerKey: boolean;
  scopeLabel: string;
  activeTab: StudyModeViewTab;
}

const MAX_EXCERPT_CHARS = 1200;
const MAX_ARTIFACT_CHARS = 700;
const MAX_TOTAL_CHARS = 2400;

function trimCompact(text: string | null | undefined, maxChars: number): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Assembles a bounded, study-aware context block for Plethora's existing Assistant
 * while strictly preventing hidden formative answer keys, correct indices, expected
 * blanks, or grading rubrics from leaking into the Assistant context before submission.
 */
export function buildStudyAssistantContext(
  input: StudyAssistantContextInput,
): StudyAssistantContextSummary {
  const lines: string[] = [
    `[Study Mode Context]`,
    `Document: ${input.documentTitle}`,
    `Scope: ${input.scopeLabel}`,
    `Active activity: ${input.activeTab}`,
    `Knowledge authority: ${input.knowledgeAuthority}`,
  ];

  if (input.studyPlanContext) {
    lines.push(
      `Study Plan: ${input.studyPlanContext.planId} / Topic: ${input.studyPlanContext.topicId}${
        input.studyPlanContext.segmentId ? ` / Segment: ${input.studyPlanContext.segmentId}` : ""
      }`,
    );
  }

  if (input.selectedConceptLabel) {
    lines.push(`Selected concept: ${input.selectedConceptLabel}`);
  }

  let withheldAnswerKey = false;
  if (input.activeQuestion) {
    lines.push(`Current practice question (${input.activeQuestion.questionKind}): ${input.activeQuestion.prompt}`);
    if (!input.activeQuestionSubmitted) {
      // Strictly exclude correctIndex, expectedBlanks, correctOrder, requiredKeyFacts, explanation.
      withheldAnswerKey = true;
      lines.push(
        `Note: The learner has NOT submitted an answer yet. Guide with hints or questions without revealing the answer.`,
      );
    } else if (input.lastEvaluation && input.lastEvaluation.questionId === input.activeQuestion.id) {
      lines.push(
        `Submitted outcome: ${input.lastEvaluation.outcome} (${Math.round(input.lastEvaluation.score * 100)}%)`,
      );
      if (input.lastEvaluation.misconceptionDetected) {
        lines.push(`Detected misconception: ${input.lastEvaluation.misconceptionDetected}`);
      }
    }
  }

  if (input.activeArtifact && input.activeTab !== "practice") {
    const title = String(input.activeArtifact.payload.title ?? input.activeArtifact.artifactType);
    const body = trimCompact(
      typeof input.activeArtifact.payload.body === "string"
        ? input.activeArtifact.payload.body
        : "",
      MAX_ARTIFACT_CHARS,
    );
    lines.push(`Active study material (${input.activeArtifact.artifactType}): ${title}`);
    if (body) {
      lines.push(`Material excerpt: ${body}`);
    }
  }

  const excerpt = trimCompact(input.scopeExcerpt, MAX_EXCERPT_CHARS);
  if (excerpt && !(input.activeTab === "practice" && !input.activeQuestionSubmitted)) {
    lines.push(`Authorized source excerpt:\n${excerpt}`);
  }

  const joined = lines.join("\n");
  return {
    contextText:
      joined.length > MAX_TOTAL_CHARS
        ? `${joined.slice(0, MAX_TOTAL_CHARS - 1).trimEnd()}…`
        : joined,
    withheldAnswerKey,
    scopeLabel: input.scopeLabel,
    activeTab: input.activeTab,
  };
}

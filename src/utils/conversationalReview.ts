import { runTask } from "../lib/ai/tasks/runTask";
import { conversationalFollowUpTask } from "../lib/ai/tasks/definitions/workflowTasks";
import { runAiAction } from "../lib/ai/provider";
import { fnv1aHash } from "../lib/ai/providers/types";

export interface ConversationalAssessment {
  id: string;
  itemId: string;
  timestamp: string;
  userResponse: string;
  followUpQuestion: string;
  score: number;
  feedback: string;
}

const STORAGE_KEY = "plethora.conversational-review-assessments";

export async function requestTutorFollowUp(
  topic: string,
  userResponse: string
): Promise<{ question: string; score: number; feedback: string }> {
  const targetId = fnv1aHash(`conversational\u0000${topic}\u0000${userResponse.slice(0, 512)}`);
  const result = await runAiAction(
    {
      onDevice: () =>
        runTask(conversationalFollowUpTask, { topic, userResponse }, {
          targetId,
          kind: "ondevice",
        }),
      cloud: () =>
        runTask(conversationalFollowUpTask, { topic, userResponse }, {
          targetId,
          kind: "cloud",
        }),
    },
    "Conversational follow-up"
  );

  const text = result?.text ?? "";
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const score = Number(parsed.score);
    return {
      question: String(parsed.question || "Can you explain one concrete example?"),
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
      feedback: String(parsed.feedback || "Keep practicing active recall."),
    };
  } catch {
    return {
      question: "Can you explain this in your own words with one example?",
      score: 0,
      feedback: text.slice(0, 200),
    };
  }
}

export function saveConversationalAssessment(assessment: ConversationalAssessment): void {
  const current = getConversationalAssessments();
  const next = [assessment, ...current].slice(0, 500);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getConversationalAssessments(itemId?: string): ConversationalAssessment[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ConversationalAssessment[];
    if (!itemId) return parsed;
    return parsed.filter((entry) => entry.itemId === itemId);
  } catch {
    return [];
  }
}

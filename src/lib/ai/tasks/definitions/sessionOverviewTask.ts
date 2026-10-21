/**
 * `sessionOverviewTask` — Hierarchical session overview task (Task 3.4, Design D8).
 *
 * Synthesizes validated evidence-linked summaries from earlier sections into a
 * comprehensive session overview without receiving unbounded original transcripts.
 */

import {
  SESSION_OVERVIEW_SCHEMA,
  validateSessionOverviewAnalysis,
  type SessionOverviewAnalysisResult,
  type SessionProfileObservations,
} from "../../schemas/sessionAnalysis";
import { getProfileAnalysisGuidance } from "../../../../services/recording/analysis/profiles";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

export const SESSION_OVERVIEW_TASK_ID = "session-overview";

export const SESSION_OVERVIEW_TIMEOUT_MS = 60_000;
export const SESSION_OVERVIEW_MAX_OUTPUT_TOKENS = 2000;

export interface SessionOverviewInput {
  sessionId: string;
  summaries: Array<{
    unitKey: string;
    summary: string;
    topics?: string[];
    observations?: SessionProfileObservations;
  }>;
  profile?: string;
  enableDecisionsAndActions?: boolean;
}

function formatObservations(
  observations: SessionProfileObservations | undefined
): string | null {
  if (!observations) return null;
  const fields: Array<[string, string[] | undefined]> = [
    ["Decisions", observations.decisions],
    ["Action items", observations.actionItems],
    ["Questions", observations.questions],
    ["Key takeaways", observations.keyTakeaways],
  ];
  const lines = fields
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([label, values]) => `${label}: ${(values as string[]).join(" | ")}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

const OVERVIEW_CORE_INSTRUCTION = [
  "You are an expert learning analyst. Synthesize the provided section summaries into a comprehensive session overview.",
  "",
  "RULES & INSTRUCTIONS:",
  "1. The model receives only validated summaries with source keys, never unbounded original transcripts.",
  "2. Provide an overarching executive overviewSummary synthesizing the session.",
  "3. Construct a clear, structured outline covering the major progression.",
  "4. Formulate 3-7 key takeaways capturing core knowledge, insights, or decisions.",
  "5. Reconcile and list the key concepts developed across the session.",
  "6. Do not fabricate facts that are not represented in the section summaries.",
  "7. Emphasize the outputs requested by the session profile; omit decisions/action items when they are not authorized.",
  "8. Questions, insights and arguments must remain evidence-based; never invent speakers, owners or commitments.",
  "",
  "Return ONLY the structured JSON matching the schema.",
].join("\n");

export const sessionOverviewTask: AITaskDefinition<
  SessionOverviewInput,
  SessionOverviewAnalysisResult
> = {
  id: SESSION_OVERVIEW_TASK_ID,
  taskType: "summarization",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n\n${OVERVIEW_CORE_INSTRUCTION}`,
  buildInput: ({ summaries, profile, enableDecisionsAndActions }) => {
    const parts: string[] = ["Synthesize the following section summaries into a comprehensive session overview."];

    parts.push(`Session profile: ${profile ?? "other"}`);
    parts.push(`Profile guidance: ${getProfileAnalysisGuidance(profile)}`);

    if (enableDecisionsAndActions !== undefined) {
      parts.push(
        enableDecisionsAndActions
          ? "Decisions and action items are AUTHORIZED for this profile."
          : "Decisions and action items are NOT authorized for this profile; omit them."
      );
    }

    const summariesPayload = summaries
      .map((s) => {
        const observationText = formatObservations(s.observations);
        return [
          `[Section ${s.unitKey}]`,
          `Summary: ${s.summary}`,
          `Topics: ${(s.topics || []).join(", ")}`,
          ...(observationText ? [`Observations:\n${observationText}`] : []),
        ].join("\n");
      })
      .join("\n\n");

    parts.push(
      "Section summaries to synthesize:",
      wrapUntrustedBlock("section-summaries", summariesPayload)
    );

    return { text: parts.join("\n\n") };
  },
  outputKind: "structured",
  schema: SESSION_OVERVIEW_SCHEMA,
  validate: (raw) => {
    return validateSessionOverviewAnalysis(raw);
  },
  maxOutputTokens: SESSION_OVERVIEW_MAX_OUTPUT_TOKENS,
  timeoutMs: SESSION_OVERVIEW_TIMEOUT_MS,
  streaming: false,
  requirement: "summarization",
};

registerTasks(sessionOverviewTask);

/**
 * `sessionSectionAnalysisTask` — Single-pass section analysis task (Task 3.4, Design D8).
 *
 * Full model class, structured output validated against `SESSION_SECTION_ANALYSIS_SCHEMA`.
 * Generates:
 *   - Section summary (<= 300 tokens)
 *   - Topics / outline
 *   - Concepts with definitions
 *   - Verbatim extract proposals (<= 3, quote <= 8k chars)
 *   - Spaced repetition cards (<= 8 cards, <= 2 per concept)
 *   - Profile-specific observations (decisions, actions, questions for Meeting profile)
 *
 * Enforces prompt injection containment (D9) and strict citation rules:
 *   - Context overlap in `<untrusted_source id="context-overlap">` is background context ONLY.
 *   - Evidence MUST cite `<untrusted_source id="owned-transcript">` verbatim.
 *   - Mathematical and technical notation copied unchanged.
 */

import {
  SESSION_SECTION_ANALYSIS_SCHEMA,
  validateSessionSectionAnalysis,
  type SessionSectionAnalysisResult,
} from "../../schemas/sessionAnalysis";
import { getProfileAnalysisGuidance } from "../../../../services/recording/analysis/profiles";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

export const SESSION_SECTION_ANALYSIS_TASK_ID = "session-section-analysis";

export const SESSION_SECTION_ANALYSIS_TIMEOUT_MS = 60_000;
export const SESSION_SECTION_ANALYSIS_MAX_OUTPUT_TOKENS = 1500;

export interface SessionSectionAnalysisInput {
  sessionId: string;
  unitKey: string;
  /** Verbatim text owned by this unit. All quotations and card evidence must come from here. */
  ownedText: string;
  /** Optional previous-unit overlap for flow. STRICTLY context-only; never cite as new evidence. */
  contextText?: string;
  /** Output profile: "Lecture" | "Meeting" | "Interview" | "Seminar" | "Podcast" | "Voice note" */
  profile?: string;
  /** Explicit session output selection; omitted means use profile guidance only. */
  enableCards?: boolean;
  enableExtracts?: boolean;
  /** Optional summary of the preceding section to maintain narrative continuity. */
  priorTopicSummary?: string;
}

const SECTION_ANALYSIS_CORE_INSTRUCTION = [
  "You are an expert learning analyst. Analyze the provided recording transcript section and return a structured JSON analysis in a single pass.",
  "",
  "RULES & INSTRUCTIONS:",
  "1. CONTEXT VS OWNED EVIDENCE:",
  "   - The passage in <untrusted_source id=\"owned-transcript\"> is the new material for this section.",
  "   - If present, <untrusted_source id=\"context-overlap\"> contains the tail of the PREVIOUS section for narrative context only.",
  "   - CRITICAL: Never cite, extract, or test material that appears only in context-overlap. All extracts and card evidence MUST be verbatim quotes from owned-transcript.",
  "",
  "2. VERBATIM EXTRACTS (max 3):",
  "   - Propose 1-3 high-value, verbatim quotations from owned-transcript (max 8,000 characters each).",
  "   - Preserve mathematical formulas, code, and technical terminology exactly as written.",
  "   - If you provide a summaryNote, it must be an explanatory note, never a copy of the quotation.",
  "",
  "3. CONCEPTS & TOPICS:",
  "   - List 2-6 main concepts introduced in this section with brief definitions.",
  "   - List 2-5 topic outline points.",
  "",
  "4. LEARNING CARDS (max 8 cards, max 2 per concept):",
  "   - Propose cards ONLY when the input explicitly says card proposals are authorized and the profile guidance calls for them.",
  "   - If cards are not authorized, return an empty cards array.",
  "   - Card types: definition, qa, cloze, process, comparison, causeEffect, formula, example.",
  "   - For cloze cards: clozeText must quote the sentence verbatim with {{c1::deletion}} where deletion appears word-for-word in owned-transcript.",
  "   - Every card must include an evidenceQuote copied word-for-word from owned-transcript.",
  "   - Never generate generic questions like 'What is this about?' or 'Summarize the text'.",
  "",
  "5. PROFILE OBSERVATIONS:",
  "   - For Meeting profiles, extract decisions, action items, questions raised and commitments.",
  "   - For Interview profiles, extract questions asked, concise answers/insights and notable passages.",
  "   - For Seminar/Presentation profiles, extract arguments, supporting evidence and key takeaways.",
  "   - For Voice note/Other profiles, keep observations concise and omit any field without evidence.",
  "   - Use only fields supported by owned-transcript evidence; never invent owners, speakers or commitments.",
  "",
  "6. SECTION SUMMARY:",
  "   - Provide a concise summary of this section under 300 tokens.",
  "",
  "Return ONLY the structured JSON matching the schema.",
].join("\n");

export const sessionSectionAnalysisTask: AITaskDefinition<
  SessionSectionAnalysisInput,
  SessionSectionAnalysisResult
> = {
  id: SESSION_SECTION_ANALYSIS_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n\n${SECTION_ANALYSIS_CORE_INSTRUCTION}`,
  buildInput: ({ ownedText, contextText, profile, enableCards, enableExtracts, priorTopicSummary }) => {
    const parts: string[] = ["Analyze this transcript section and return the structured JSON result."];

    parts.push(`Session profile: ${profile ?? "other"}`);
    parts.push(`Profile guidance: ${getProfileAnalysisGuidance(profile)}`);

    if (enableCards !== undefined) {
      parts.push(
        `Card proposals are ${enableCards ? "AUTHORIZED for this session." : "NOT authorized for this session; return an empty cards array."}`
      );
    }
    if (enableExtracts !== undefined) {
      parts.push(
        `Verbatim extract proposals are ${enableExtracts ? "AUTHORIZED for this session." : "NOT authorized for this session; return an empty extractProposals array."}`
      );
    }

    if (priorTopicSummary) {
      parts.push(
        "Prior section topic summary:",
        wrapUntrustedBlock("prior-topic-summary", priorTopicSummary)
      );
    }

    if (contextText && contextText.trim()) {
      parts.push(
        "Previous section context (BACKGROUND ONLY - DO NOT CITE AS EVIDENCE):",
        wrapUntrustedBlock("context-overlap", contextText)
      );
    }

    parts.push(
      "Owned transcript to analyze (ALL CITATIONS MUST COME FROM HERE):",
      wrapUntrustedBlock("owned-transcript", ownedText)
    );

    return { text: parts.join("\n\n") };
  },
  outputKind: "structured",
  schema: SESSION_SECTION_ANALYSIS_SCHEMA,
  validate: (raw, input) => {
    return validateSessionSectionAnalysis(raw, {
      ownedText: input?.ownedText,
    });
  },
  maxOutputTokens: SESSION_SECTION_ANALYSIS_MAX_OUTPUT_TOKENS,
  timeoutMs: SESSION_SECTION_ANALYSIS_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

registerTasks(sessionSectionAnalysisTask);

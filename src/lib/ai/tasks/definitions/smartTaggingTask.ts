/**
 * `SmartTaggingTask` — Tier 2 LLM-enhanced Semantic Tagging Task.
 *
 * Operates as a quiet, thoughtful knowledge librarian. Selects from candidate
 * existing tags in the user's library and proposes high-confidence new tags.
 *
 * All document text is treated as untrusted data and wrapped in
 * `<untrusted_source>` blocks with strict prompt-injection containment.
 *
 * If the LLM provider fails, times out, or is offline, seamlessly falls back
 * to the Tier 1 baseline classifier.
 */

import type { SmartTagDetail } from "../../../../types/document";
import { classifyDocumentBaseline } from "../../../smartTagging/baseline";
import { canonicalizeTag, normalizeForComparison } from "../../../smartTagging/normalization";
import {
  SMART_TAGGING_SCHEMA,
  validateSmartTaggingOutput,
  type SmartTaggingOutput,
} from "../../schemas/smartTagging";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import type { AITaskDefinition, AITaskRunOptions } from "../types";
import {
  buildSmartTaggingContext,
  type SmartTaggingContextInput,
} from "./smartTaggingContext";

export const SMART_TAGGING_TASK_ID = "smart-tagging";
export const SMART_TAGGING_TIMEOUT_MS = 30_000;
export const SMART_TAGGING_MAX_OUTPUT_TOKENS = 500;

export interface SmartTaggingTaskInput extends SmartTaggingContextInput {
  existingLibraryTagsList?: Array<{ name: string; itemCount?: number }>;
  manualTags?: string[];
  dismissedTags?: string[];
  maxTagsPerDocument?: number;
}

const SMART_TAGGING_CORE_INSTRUCTION = [
  "You are a quiet, precise knowledge librarian organizing documents for a personal library.",
  "Analyze the document title, headings, excerpts, and keywords in the <untrusted_source> blocks.",
  "1. Review candidate existing tags from the user's library. If the document is about any of these subjects, select them in existingTags with a confidence score (0.0-1.0) and a concise 1-sentence reason.",
  "2. If the document covers distinct important subjects not covered by existing candidate tags, propose 1 to 3 concise, standard semantic tags in proposedNewTags with confidence and reason.",
  "3. Prefer existing tags over creating synonyms (e.g., if 'Machine Learning' exists, do not propose 'AI/ML' or 'ML').",
  "4. Do NOT assign tags for incidental, passing mentions. If the document has no clear subject matter, return empty arrays.",
  "5. Return ONLY the valid JSON object matching the requested schema.",
].join("\n");

function buildSmartTaggingInput(input: SmartTaggingTaskInput) {
  const context = buildSmartTaggingContext(input);

  const lines = [
    "Identify semantic subject tags for this document:",
    "",
    "Document Title:",
    wrapUntrustedBlock("document-title", context.title),
    "",
  ];

  if (context.author) {
    lines.push("Author:", wrapUntrustedBlock("author", context.author), "");
  }

  if (context.headings.length > 0) {
    lines.push(
      "Table of Contents / Section Headings:",
      wrapUntrustedBlock("headings", context.headings.join("\n")),
      ""
    );
  }

  if (context.topKeywords.length > 0) {
    lines.push(
      "Extracted Salient Keywords:",
      wrapUntrustedBlock("top-keywords", context.topKeywords.join(", ")),
      ""
    );
  }

  if (context.introExcerpt) {
    lines.push(
      "Introduction / Preface Excerpt:",
      wrapUntrustedBlock("intro-excerpt", context.introExcerpt),
      ""
    );
  }

  if (context.conclusionExcerpt) {
    lines.push(
      "Conclusion / Summary Excerpt:",
      wrapUntrustedBlock("conclusion-excerpt", context.conclusionExcerpt),
      ""
    );
  }

  if (context.sourceUrl || context.sourceDomain) {
    lines.push(
      "Browser Source Identity:",
      wrapUntrustedBlock("source-identity", [context.sourceDomain, context.sourceUrl].filter(Boolean).join(" | ")),
      ""
    );
  }

  if (context.nearbyText) {
    lines.push("Nearby Browser Context:", wrapUntrustedBlock("nearby-context", context.nearbyText), "");
  }

  if (context.captionAltText) {
    lines.push("Caption / Alt Evidence:", wrapUntrustedBlock("caption-alt", context.captionAltText), "");
  }

  if (context.sourceTags.length > 0) {
    lines.push(
      "Source Tags (evidence only; do not copy without item-local support):",
      wrapUntrustedBlock("source-tags", context.sourceTags.join(", ")),
      ""
    );
  }

  if (context.candidateExistingTags.length > 0) {
    lines.push(
      "Candidate Existing Tags from User's Library:",
      wrapUntrustedBlock("candidate-tags", context.candidateExistingTags.join(", ")),
      ""
    );
  }

  lines.push(
    `Respond with ONLY a JSON object matching this schema: ${SMART_TAGGING_SCHEMA.json}`
  );

  return { text: lines.join("\n") };
}

export const smartTaggingTask: AITaskDefinition<
  SmartTaggingTaskInput,
  SmartTaggingOutput
> = {
  id: SMART_TAGGING_TASK_ID,
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${SMARING_CORE_INSTRUCTION(SMART_TAGGING_CORE_INSTRUCTION)}`,
  buildInput: buildSmartTaggingInput,
  outputKind: "structured",
  schema: SMART_TAGGING_SCHEMA,
  validate: (output) => validateSmartTaggingOutput(output),
  maxOutputTokens: SMART_TAGGING_MAX_OUTPUT_TOKENS,
  timeoutMs: SMART_TAGGING_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

function SMARING_CORE_INSTRUCTION(instruction: string): string {
  return instruction;
}

/**
 * Execute Smart Tagging for a document.
 *
 * If LLM execution succeeds, maps structured output to SmartTagDetails with 'smart-llm' provenance.
 * If LLM execution fails, times out, or returns invalid schema, seamlessly falls back to
 * Tier 1 baseline tags with 'smart-local' provenance.
 */
export async function runSmartTagging(
  input: SmartTaggingTaskInput,
  options: AITaskRunOptions = {}
): Promise<{
  tagDetails: SmartTagDetail[];
  provenance: "smart-llm" | "smart-local";
  fallbackUsed: boolean;
}> {
  const maxTags = input.maxTagsPerDocument || 6;
  const existingNames = (input.existingLibraryTagsList || []).map((t) => t.name);
  const dismissedNorms = new Set((input.dismissedTags || []).map(normalizeForComparison));
  const manualNorms = new Set((input.manualTags || []).map(normalizeForComparison));
  const now = new Date().toISOString();

  try {
    const run = await runTask(smartTaggingTask, input, {
      targetId: `smart-tagging:${input.title.slice(0, 48)}`,
      ...options,
    });

    const output = run.output;
    const tagDetails: SmartTagDetail[] = [];
    const seenCanonical = new Set<string>();

    // 1. Process accepted existing tags
    for (const item of output.existingTags || []) {
      if (item.confidence >= 0.70) {
        const canonical = canonicalizeTag(item.tag, existingNames);
        const norm = normalizeForComparison(canonical);
        if (!dismissedNorms.has(norm) && !manualNorms.has(norm) && !seenCanonical.has(norm)) {
          seenCanonical.add(norm);
          tagDetails.push({
            tag: canonical,
            provenance: "smart-llm",
            confidence: item.confidence,
            reason: item.reason || "Semantic relevance identified by AI",
            assignedAt: now,
          });
        }
      }
    }

    // 2. Process accepted proposed new tags
    for (const item of output.proposedNewTags || []) {
      if (tagDetails.length >= maxTags) break;
      if (item.confidence >= 0.70) {
        const canonical = canonicalizeTag(item.name, existingNames);
        const norm = normalizeForComparison(canonical);
        if (!dismissedNorms.has(norm) && !manualNorms.has(norm) && !seenCanonical.has(norm)) {
          seenCanonical.add(norm);
          tagDetails.push({
            tag: canonical,
            provenance: "smart-llm",
            confidence: item.confidence,
            reason: item.reason || "Semantic topic identified by AI",
            assignedAt: now,
          });
        }
      }
    }

    tagDetails.sort((a, b) => b.confidence - a.confidence);
    const finalDetails = tagDetails.slice(0, maxTags);

    return {
      tagDetails: finalDetails,
      provenance: "smart-llm",
      fallbackUsed: false,
    };
  } catch (error) {
    console.warn("[SmartTagging] Tier 2 LLM execution failed, falling back to Tier 1 baseline:", error);
    const baselineDetails = classifyDocumentBaseline({
      title: input.title,
      headings: input.headings,
      body: [input.content, input.nearbyText, input.captionAltText].filter(Boolean).join("\n"),
      existingLibraryTags: input.existingLibraryTagsList,
      manualTags: input.manualTags,
      dismissedTags: input.dismissedTags,
      config: { maxTags },
    });

    return {
      tagDetails: baselineDetails,
      provenance: "smart-local",
      fallbackUsed: true,
    };
  }
}

registerTasks(smartTaggingTask);

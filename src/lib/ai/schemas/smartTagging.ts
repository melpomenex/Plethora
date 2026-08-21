/**
 * `SmartTaggingOutput` — structured schema for LLM-enhanced Smart Tagging.
 */

import {
  checkNumber,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export interface ExistingTagSelection {
  tag: string;
  confidence: number;
  reason: string;
}

export interface ProposedNewTag {
  name: string;
  confidence: number;
  reason: string;
}

export interface SmartTaggingOutput {
  existingTags: ExistingTagSelection[];
  proposedNewTags: ProposedNewTag[];
}

export const SMART_TAGGING_SCHEMA = {
  name: "SmartTagging",
  nativeName: "smartTagging",
  json: JSON.stringify({
    existingTags: [
      {
        tag: "string (must match one of candidate tags if selected)",
        confidence: "0.0-1.0",
        reason: "string (concise 1-sentence explainability reason)",
      },
    ],
    proposedNewTags: [
      {
        name: "string (concise semantic topic, 1-3 words)",
        confidence: "0.0-1.0",
        reason: "string (concise 1-sentence explainability reason)",
      },
    ],
  }),
} as const;

export function validateSmartTaggingOutput(
  output: unknown
): ValidationOutcome<SmartTaggingOutput> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const existingTags: ExistingTagSelection[] = [];
  if (!Array.isArray(output.existingTags)) {
    errors.push("existingTags: expected array");
  } else {
    for (let i = 0; i < output.existingTags.length; i++) {
      const item = output.existingTags[i];
      if (!isRecord(item)) {
        errors.push(`existingTags[${i}]: expected object`);
        continue;
      }
      const tag = checkString(item.tag, `existingTags[${i}].tag`, errors, { minLength: 1, maxLength: 100 });
      const confidence = checkNumber(item.confidence, `existingTags[${i}].confidence`, errors, { min: 0, max: 1 });
      const reason = checkString(item.reason, `existingTags[${i}].reason`, errors, { minLength: 1, maxLength: 500 });
      if (tag !== undefined && confidence !== undefined && reason !== undefined) {
        existingTags.push({ tag, confidence, reason });
      }
    }
  }

  const proposedNewTags: ProposedNewTag[] = [];
  if (!Array.isArray(output.proposedNewTags)) {
    errors.push("proposedNewTags: expected array");
  } else {
    for (let i = 0; i < output.proposedNewTags.length; i++) {
      const item = output.proposedNewTags[i];
      if (!isRecord(item)) {
        errors.push(`proposedNewTags[${i}]: expected object`);
        continue;
      }
      const name = checkString(item.name, `proposedNewTags[${i}].name`, errors, { minLength: 1, maxLength: 100 });
      const confidence = checkNumber(item.confidence, `proposedNewTags[${i}].confidence`, errors, { min: 0, max: 1 });
      const reason = checkString(item.reason, `proposedNewTags[${i}].reason`, errors, { minLength: 1, maxLength: 500 });
      if (name !== undefined && confidence !== undefined && reason !== undefined) {
        proposedNewTags.push({ name, confidence, reason });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return valid({ existingTags, proposedNewTags });
}

/**
 * `OcclusionLabelSelection` — structured envelope of the OCR-backed occlusion
 * task (design D18 / ai-image-occlusion spec).
 *
 * The model only selects/words/groups OCR labels BY REFERENCE. Geometry is
 * never accepted from the model: any geometry-looking key on a selection
 * rejects the payload (deterministic OCR boxes are the only geometry source).
 */

import {
  checkBoolean,
  checkString,
  checkStringArray,
  isRecord,
  rejectGeometryKeys,
  valid,
  type ValidationOutcome,
} from "./common";

export const MAX_OCCLUSION_SELECTIONS = 8;

export interface OcclusionLabelSelectionEntry {
  /** OCR label ids grouped onto one card. */
  labelIds: string[];
  question: string;
  answer: string;
}

export interface OcclusionLabelRejection {
  labelId: string;
  reason: string;
}

export interface OcclusionLabelSelection {
  /** Whether the image is appropriate for occlusion study at all. */
  appropriate: boolean;
  selections: OcclusionLabelSelectionEntry[];
  rejected: OcclusionLabelRejection[];
}

export const OCCLUSION_LABEL_SCHEMA = {
  name: "OcclusionLabelSelection",
  nativeName: "occlusionLabelSelection",
  json: JSON.stringify({
    appropriate: "boolean",
    selections: [{ labelIds: ["label-id"], question: "string", answer: "string" }],
    rejected: [{ labelId: "label-id", reason: "string" }],
  }),
} as const;

export interface OcclusionLabelValidationContext {
  /** OCR label ids detected for the image. */
  knownLabelIds?: string[];
}

export function validateOcclusionLabelSelection(
  output: unknown,
  context: OcclusionLabelValidationContext = {}
): ValidationOutcome<OcclusionLabelSelection> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }
  rejectGeometryKeys(output, "root", errors);

  const appropriate = checkBoolean(output.appropriate, "appropriate", errors);
  const selections = parseSelections(output.selections, errors, context);
  const rejected = parseRejections(output.rejected, errors, context);

  if (appropriate === true && selections !== undefined && selections.length === 0) {
    errors.push("selections: an appropriate image must propose at least one selection");
  }
  if (appropriate === false && selections !== undefined && selections.length > 0) {
    errors.push("selections: an inappropriate image must not propose selections");
  }

  if (errors.length > 0 || appropriate === undefined) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }
  return valid({
    appropriate,
    selections: selections ?? [],
    rejected: rejected ?? [],
  });
}

function parseSelections(
  value: unknown,
  errors: string[],
  context: OcclusionLabelValidationContext
): OcclusionLabelSelectionEntry[] | undefined {
  if (value === undefined) {
    errors.push("selections: required");
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push("selections: expected array");
    return undefined;
  }
  if (value.length > MAX_OCCLUSION_SELECTIONS) {
    errors.push(`selections: more than ${MAX_OCCLUSION_SELECTIONS} entries`);
    return undefined;
  }
  const out: OcclusionLabelSelectionEntry[] = [];
  (value as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`selections[${index}]: expected object`);
      return;
    }
    rejectGeometryKeys(raw, `selections[${index}]`, errors);
    const labelIds = checkStringArray(raw.labelIds, `selections[${index}].labelIds`, errors, {
      max: 6,
      maxLength: 100,
    });
    const question = checkString(raw.question, `selections[${index}].question`, errors, {
      maxLength: 1000,
    });
    const answer = checkString(raw.answer, `selections[${index}].answer`, errors, {
      maxLength: 1000,
    });
    if (labelIds === undefined || labelIds.length === 0) {
      errors.push(`selections[${index}].labelIds: at least one label id is required`);
      return;
    }
    if (
      context.knownLabelIds &&
      labelIds.some((id) => !context.knownLabelIds!.includes(id))
    ) {
      errors.push(`selections[${index}].labelIds: references an unknown OCR label id`);
      return;
    }
    if (question !== undefined && answer !== undefined) {
      out.push({ labelIds, question, answer });
    }
  });
  return errors.length > 0 ? undefined : out;
}

function parseRejections(
  value: unknown,
  errors: string[],
  context: OcclusionLabelValidationContext
): OcclusionLabelRejection[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("rejected: expected array");
    return undefined;
  }
  if (value.length > 64) {
    errors.push("rejected: more than 64 entries");
    return undefined;
  }
  const out: OcclusionLabelRejection[] = [];
  (value as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`rejected[${index}]: expected object`);
      return;
    }
    rejectGeometryKeys(raw, `rejected[${index}]`, errors);
    const labelId = checkString(raw.labelId, `rejected[${index}].labelId`, errors, {
      maxLength: 100,
    });
    const reason = checkString(raw.reason, `rejected[${index}].reason`, errors, {
      maxLength: 500,
    });
    if (labelId === undefined) return;
    if (context.knownLabelIds && !context.knownLabelIds.includes(labelId)) {
      errors.push(`rejected[${index}].labelId: references an unknown OCR label id`);
      return;
    }
    if (reason !== undefined) out.push({ labelId, reason });
  });
  return errors.length > 0 ? undefined : out;
}

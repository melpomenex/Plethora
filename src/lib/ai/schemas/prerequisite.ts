/**
 * `PrerequisiteAnalysis` — structured envelope of the prerequisite-analysis
 * task (design D23 / ai-knowledge-relationships spec), field-aligned with the
 * Kotlin `@Schema` envelope.
 *
 * The model only PROPOSES prerequisite concepts with a rationale. Evidence
 * coverage (`coverageLevel`, `evidenceRefs`) is produced deterministically by
 * the TS coverage-estimation runner against the user's material — it is never
 * model output — and UI language stays hedged ("appears to be a gap").
 */

import {
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export const MAX_PREREQUISITES = 12;

export interface PrerequisiteCandidate {
  /** Proposed prerequisite concept name. */
  concept: string;
  /** Why this concept appears to be a prerequisite of the analyzed material. */
  why: string;
}

export interface PrerequisiteAnalysis {
  prerequisites: PrerequisiteCandidate[];
}

export const PREREQUISITE_ANALYSIS_SCHEMA = {
  name: "PrerequisiteAnalysis",
  nativeName: "prerequisiteAnalysis",
  json: JSON.stringify({
    prerequisites: [{ concept: "string", why: "string" }],
  }),
} as const;

export function validatePrerequisiteAnalysis(
  output: unknown
): ValidationOutcome<PrerequisiteAnalysis> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const prerequisites: PrerequisiteCandidate[] = [];
  if (!Array.isArray(output.prerequisites)) {
    errors.push("prerequisites: expected array");
  } else if (output.prerequisites.length > MAX_PREREQUISITES) {
    errors.push(`prerequisites: more than ${MAX_PREREQUISITES} entries`);
  } else {
    (output.prerequisites as unknown[]).forEach((raw, index) => {
      if (!isRecord(raw)) {
        errors.push(`prerequisites[${index}]: expected object`);
        return;
      }
      const concept = checkString(raw.concept, `prerequisites[${index}].concept`, errors, {
        maxLength: 120,
      });
      const why = checkString(raw.why, `prerequisites[${index}].why`, errors, {
        maxLength: 1000,
      });
      if (concept === undefined || why === undefined) return;
      prerequisites.push({ concept, why });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return valid({ prerequisites });
}

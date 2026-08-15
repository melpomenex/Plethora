/**
 * Agent-tool argument validation helpers (task 8.1).
 *
 * Every tool's `validate` runs BEFORE any API call and:
 *  - rejects unknown parameters (spec: "unsupported parameters SHALL be
 *    rejected") — a model inventing `count: 50` on `propose_flashcard` gets
 *    a visible invalid-input result, not a mass creation;
 *  - clamps numeric `limit`-style parameters to ≤ 20;
 *  - type-checks every accepted parameter (schemas/common style).
 */

import { checkNumber, isRecord } from "../../schemas/common";

/** Hard clamp for every list-returning tool parameter. */
export const MAX_TOOL_LIMIT = 20;

export function rejectUnknownParams(
  input: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      errors.push(`${path}.${key}: unknown parameter (allowed: ${allowed.join(", ")})`);
    }
  }
  return errors;
}

/**
 * Validate + clamp an optional positive integer limit parameter.
 * Missing → default; out-of-range → clamped (limits are soft, caps are hard).
 */
export function optionalLimit(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
  defaultValue: number
): number {
  const raw = input[key];
  if (raw === undefined || raw === null) return defaultValue;
  const value = checkNumber(raw, key, errors, { min: 1, integer: true });
  if (value === undefined) return defaultValue;
  return Math.min(value, MAX_TOOL_LIMIT);
}

/** Non-empty bounded string parameter. Returns undefined on failure. */
export function requireString(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
  options: { maxLength?: number; minLength?: number } = {}
): string | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) {
    errors.push(`${key}: required`);
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.push(`${key}: expected string`);
    return undefined;
  }
  const trimmed = raw.trim();
  const min = options.minLength ?? 1;
  if (trimmed.length < min) {
    errors.push(`${key}: shorter than ${min} characters`);
    return undefined;
  }
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    errors.push(`${key}: longer than ${options.maxLength} characters`);
    return undefined;
  }
  return trimmed;
}

export function isRecordInput(input: unknown): input is Record<string, unknown> {
  return isRecord(input);
}

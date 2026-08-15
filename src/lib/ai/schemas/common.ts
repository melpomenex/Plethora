/**
 * Shared primitives for the hand-written structured-output validators
 * (design D5): `cardValidator.ts` style plain functions, no new runtime
 * dependencies. Validators enforce shape, enums, ranges, and caps — fail
 * closed, never producing partially valid objects.
 */

export interface AISchemaNames {
  /** Canonical schema name (PascalCase, matches the Kotlin data class). */
  name: string;
  /** Native wire name for schema-compiled structured requests (camelCase). */
  nativeName: string;
  /** Compact JSON shape handed to strict-JSON prompt mode. */
  json: string;
}

export type ValidationOutcome<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Explicit outcome guards. The repo compiles without `strictNullChecks`,
 * where boolean-discriminant narrowing of these unions does not apply — use
 * these predicates instead of `if (outcome.ok)` checks.
 */
export function isValidOutcome<T>(
  outcome: ValidationOutcome<T>
): outcome is { ok: true; value: T } {
  return outcome.ok === true;
}

export function isFailedOutcome<T>(
  outcome: ValidationOutcome<T>
): outcome is { ok: false; errors: string[] } {
  return outcome.ok !== true;
}

export function valid<T>(value: T): ValidationOutcome<T> {
  return { ok: true, value };
}

export function invalid(path: string, reason: string): { ok: false; errors: string[] } {
  return { ok: false, errors: [`${path}: ${reason}`] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkString(
  value: unknown,
  path: string,
  errors: string[],
  options: { maxLength?: number; minLength?: number } = {}
): string | undefined {
  if (typeof value !== "string") {
    errors.push(`${path}: expected string`);
    return undefined;
  }
  const trimmed = value.trim();
  const min = options.minLength ?? 1;
  if (trimmed.length < min) {
    errors.push(`${path}: shorter than ${min} characters`);
    return undefined;
  }
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    errors.push(`${path}: longer than ${options.maxLength} characters`);
    return undefined;
  }
  return trimmed;
}

export function checkNumber(
  value: unknown,
  path: string,
  errors: string[],
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path}: expected finite number`);
    return undefined;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${path}: expected integer`);
    return undefined;
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${path}: below minimum ${options.min}`);
    return undefined;
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${path}: above maximum ${options.max}`);
    return undefined;
  }
  return value;
}

export function checkBoolean(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
    return undefined;
  }
  return value;
}

export function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of [${allowed.join("|")}]`);
    return undefined;
  }
  return value as T;
}

/**
 * Validate an array of strings with a hard cap. Fail-closed on non-arrays;
 * items validated individually so one bad entry rejects the payload.
 */
export function checkStringArray(
  value: unknown,
  path: string,
  errors: string[],
  options: { max?: number; min?: number; maxLength?: number; lowerCase?: boolean } = {}
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return undefined;
  }
  if (options.max !== undefined && value.length > options.max) {
    errors.push(`${path}: more than ${options.max} entries`);
    return undefined;
  }
  if (options.min !== undefined && value.length < options.min) {
    errors.push(`${path}: fewer than ${options.min} entries`);
    return undefined;
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = checkString(value[i], `${path}[${i}]`, errors, {
      maxLength: options.maxLength,
    });
    if (item !== undefined) {
      out.push(options.lowerCase ? item.toLowerCase() : item);
    }
  }
  return errors.length === 0 ? out : undefined;
}

/** Reject object keys that carry geometry (occlusion safety, design D18). */
export const GEOMETRY_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "box",
  "bbox",
  "bboxPercent",
  "boxPercent",
  "rect",
  "rectangle",
  "region",
  "regions",
  "coordinates",
  "coords",
  "geometry",
  "pixelbox",
  "pixelBox",
] as const;

export function rejectGeometryKeys(
  value: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  for (const key of Object.keys(value)) {
    if ((GEOMETRY_KEYS as readonly string[]).includes(key)) {
      errors.push(
        `${path}.${key}: geometry is never accepted from the model (deterministic OCR boxes only)`
      );
    }
  }
}

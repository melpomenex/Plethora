import { DEFAULT_FSRS7_PARAMETERS } from "../algorithms/fsrs7/defaultParameters";

export const FSRS_PARAMETER_LENGTHS = [34] as const;
export const CANONICAL_FSRS_PARAMETER_LENGTH = 34;

export function isSupportedFsrsParameterLength(length: number): boolean {
  return FSRS_PARAMETER_LENGTHS.includes(length as (typeof FSRS_PARAMETER_LENGTHS)[number]);
}

export function isFsrs7Parameters(weights?: number[]): weights is number[] {
  return Array.isArray(weights) && weights.length === CANONICAL_FSRS_PARAMETER_LENGTH;
}

export function normalizeFsrsParameters(weights?: number[]): number[] | undefined {
  if (!isFsrs7Parameters(weights)) {
    return undefined;
  }

  return [...weights];
}

export function getDefaultFsrsParameters(): number[] {
  return [...DEFAULT_FSRS7_PARAMETERS];
}

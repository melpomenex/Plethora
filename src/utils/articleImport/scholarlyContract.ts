/**
 * Canonical scholarly DOM contract shared by extraction, normalization,
 * sanitization, and the HTML reader. Source/publisher vocabulary must be
 * mapped to this deliberately small namespace before it can be persisted.
 */

export const SCHOLARLY_CLASS_TOKENS = [
  'inc-article',
  'inc-raw',
  'inc-publication',
  'inc-title',
  'inc-dek',
  'inc-byline',
  'inc-hero',
  'inc-body',
  'inc-raw-notice',
  'inc-abstract',
  'inc-equation-group',
  'inc-equation',
  'inc-equation-number',
  'inc-wide',
  'inc-theorem',
  'inc-proof',
  'inc-theorem-title',
  'inc-proof-title',
  'inc-table-wrap',
  'inc-bibliography',
  'inc-reference',
  'inc-citation',
  'inc-footnotes',
  'inc-footnote',
  'inc-footnote-ref',
  'inc-footnote-backref',
] as const;

export type ScholarlyClassToken = (typeof SCHOLARLY_CLASS_TOKENS)[number];

const SCHOLARLY_CLASS_TOKEN_SET = new Set<string>(SCHOLARLY_CLASS_TOKENS);
const GENERATED_ID_PATTERN = /^inc-ref-[1-9]\d*$/;

export function isScholarlyClassToken(value: string): value is ScholarlyClassToken {
  return SCHOLARLY_CLASS_TOKEN_SET.has(value);
}

export function isGeneratedScholarlyId(value: string): boolean {
  return GENERATED_ID_PATTERN.test(value);
}

export function generatedScholarlyId(index: number): string {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new RangeError('scholarly reference index must be a positive safe integer');
  }
  return `inc-ref-${index}`;
}

export type ScholarlyAccessibilityAttribute = 'aria-label' | 'aria-labelledby';

/** Accessibility attributes are intentionally scoped to generated structures. */
export function isAllowedScholarlyAccessibilityAttribute(
  element: Element,
  attribute: string,
  value: string
): attribute is ScholarlyAccessibilityAttribute {
  const tag = element.tagName.toLowerCase();
  if (attribute === 'aria-label') {
    return (
      (tag === 'math' || element.classList.contains('inc-wide')) &&
      value.trim().length > 0 &&
      value.length <= 500
    );
  }
  if (attribute === 'aria-labelledby') {
    return isGeneratedScholarlyId(value);
  }
  return false;
}


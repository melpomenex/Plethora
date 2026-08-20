export interface NormalizationPolicy {
  caseFold: boolean;
  stripPunctuation: boolean;
  ignoreDiacritics: boolean;
  collapseWhitespace: boolean;
}

export const DEFAULT_NORMALIZATION_POLICY: NormalizationPolicy = {
  caseFold: true,
  stripPunctuation: true,
  ignoreDiacritics: false,
  collapseWhitespace: true,
};

export function normalizeLearnerText(value: string, policy: NormalizationPolicy = DEFAULT_NORMALIZATION_POLICY): string {
  let normalized = value.normalize("NFKC");
  if (policy.caseFold) normalized = normalized.toLocaleLowerCase();
  if (policy.ignoreDiacritics) normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (policy.stripPunctuation) normalized = normalized.replace(/[\p{P}\p{S}]/gu, " ");
  if (policy.collapseWhitespace) normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

export function tokenizeNormalized(value: string, policy?: NormalizationPolicy): string[] {
  const normalized = normalizeLearnerText(value, policy);
  return normalized ? normalized.split(" ") : [];
}

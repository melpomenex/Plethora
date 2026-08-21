import { normalizeLearnerText, tokenizeNormalized, type NormalizationPolicy } from "./normalize";
import type { ComparisonError, PracticeComparison } from "./types";

export function comparePracticeResponse(expected: string, actual: string, policy?: NormalizationPolicy): PracticeComparison {
  const normalizedExpected = normalizeLearnerText(expected, policy);
  const normalizedActual = normalizeLearnerText(actual, policy);
  const left = tokenizeNormalized(expected, policy);
  const right = tokenizeNormalized(actual, policy);
  const distance = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  const operations: ComparisonError[] = [];
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) distance[i]![j] = distance[i - 1]![j - 1]!;
      else distance[i]![j] = Math.min(distance[i - 1]![j]! + 1, distance[i]![j - 1]! + 1, distance[i - 1]![j - 1]! + 1);
    }
  }
  let i = left.length;
  let j = right.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) { i -= 1; j -= 1; continue; }
    const substitution = i > 0 && j > 0 ? distance[i - 1]![j - 1]! : Number.MAX_SAFE_INTEGER;
    const deletion = i > 0 ? distance[i - 1]![j]! : Number.MAX_SAFE_INTEGER;
    const insertion = j > 0 ? distance[i]![j - 1]! : Number.MAX_SAFE_INTEGER;
    if (substitution <= deletion && substitution <= insertion) {
      operations.push({ kind: "substitution", expected: left[i - 1], actual: right[j - 1], index: i - 1 }); i -= 1; j -= 1;
    } else if (deletion <= insertion) {
      operations.push({ kind: "missing", expected: left[i - 1], index: i - 1 }); i -= 1;
    } else {
      operations.push({ kind: "extra", actual: right[j - 1], index: i }); j -= 1;
    }
  }
  operations.reverse();
  const sortedLeft = [...left].sort().join("\u001f");
  const sortedRight = [...right].sort().join("\u001f");
  if (normalizedExpected !== normalizedActual && sortedLeft === sortedRight && operations.every((operation) => operation.kind === "substitution")) {
    operations.splice(0, operations.length, { kind: "order", index: 0 });
  }
  const denominator = Math.max(left.length, right.length, 1);
  return {
    exact: normalizedExpected === normalizedActual,
    score: Math.max(0, 1 - distance[left.length]![right.length]! / denominator),
    expected,
    actual,
    normalizedExpected,
    normalizedActual,
    errors: operations,
    uncertain: left.length === 0 || right.length === 0,
  };
}

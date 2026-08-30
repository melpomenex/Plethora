/** Levenshtein edit distance between two strings (character-level). */
export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + substitutionCost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column]!;
    }
  }

  return previous[right.length]!;
}

function tokenizeWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function levenshteinWordDistance(left: string[], right: string[]): number {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + substitutionCost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column]!;
    }
  }

  return previous[right.length]!;
}

/** Word error rate in [0, 1]; returns 1 when reference is empty and hypothesis is not. */
export function computeWER(reference: string, hypothesis: string): number {
  const refWords = tokenizeWords(reference);
  const hypWords = tokenizeWords(hypothesis);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  return levenshteinWordDistance(refWords, hypWords) / refWords.length;
}

/** Character error rate in [0, 1]; returns 1 when reference is empty and hypothesis is not. */
export function computeCER(reference: string, hypothesis: string): number {
  const ref = reference.trim();
  const hyp = hypothesis.trim();

  if (ref.length === 0) {
    return hyp.length === 0 ? 0 : 1;
  }

  return levenshteinDistance(ref, hyp) / ref.length;
}

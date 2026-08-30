/**
 * Token-level error-align distance matrix — adapted from Storyteller MIT
 * libraries/align/src/errorAlign/editDistance.ts
 */

import type { OpType } from "./types";

const OP_TYPES: OpType[] = ["MATCH", "INSERT", "DELETE", "SUBSTITUTE"];

function getOpTypeComboIndex(ops: OpType[]): number {
  for (let i = 0; i < OP_TYPES.length; i++) {
    const combo = combinations(OP_TYPES, i + 1);
    for (let j = 0; j < combo.length; j++) {
      const c = combo[j];
      if (c.length === ops.length && c.every((v, k) => v === ops[k])) return j;
    }
  }
  return 0;
}

function combinations<T>(arr: T[], r: number): T[][] {
  const result: T[][] = [];
  const n = arr.length;
  if (r > n) return result;
  const indices = Array.from({ length: r }, (_, i) => i);
  result.push(indices.map((i) => arr[i]));
  while (true) {
    let i = r - 1;
    while (i >= 0 && indices[i] === i + n - r) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < r; j++) indices[j] = indices[j - 1] + 1;
    result.push(indices.map((idx) => arr[idx]));
  }
  return result;
}

function getErrorAlignValues(refToken: string, hypToken: string): [number, number, number] {
  if (hypToken === refToken) return [1, 1, 0];
  return [1, 1, 2];
}

export function computeErrorAlignDistanceMatrix(
  ref: string[],
  hyp: string[],
  backtrace = false,
): number[][] | { scoreMatrix: number[][]; backtraceMatrix: number[][] } {
  const hypDim = hyp.length + 1;
  const refDim = ref.length + 1;

  const scoreMatrix: number[][] = Array.from({ length: hypDim }, () =>
    Array.from({ length: refDim }, () => 0),
  );
  for (let j = 0; j < refDim; j++) scoreMatrix[0][j] = j;
  for (let i = 0; i < hypDim; i++) scoreMatrix[i][0] = i;

  let backtraceMatrix: number[][] | null = null;
  if (backtrace) {
    backtraceMatrix = Array.from({ length: hypDim }, () =>
      Array.from({ length: refDim }, () => 0),
    );
    backtraceMatrix[0][0] = getOpTypeComboIndex(["MATCH"]);
    for (let j = 1; j < refDim; j++) backtraceMatrix[0][j] = getOpTypeComboIndex(["DELETE"]);
    for (let i = 1; i < hypDim; i++) backtraceMatrix[i][0] = getOpTypeComboIndex(["INSERT"]);
  }

  for (let j = 1; j < refDim; j++) {
    for (let i = 1; i < hypDim; i++) {
      const [insCost, delCost, diagCost] = getErrorAlignValues(ref[j - 1], hyp[i - 1]);
      const insVal = scoreMatrix[i - 1][j] + insCost;
      const delVal = scoreMatrix[i][j - 1] + delCost;
      const diagVal = scoreMatrix[i - 1][j - 1] + diagCost;
      const newVal = Math.min(insVal, delVal, diagVal);
      scoreMatrix[i][j] = newVal;

      if (backtraceMatrix) {
        const posOps: OpType[] = [];
        if (diagVal === newVal && diagCost <= 0) posOps.push("MATCH");
        if (insVal === newVal) posOps.push("INSERT");
        if (delVal === newVal) posOps.push("DELETE");
        if (diagVal === newVal && diagCost > 0) posOps.push("SUBSTITUTE");
        backtraceMatrix[i][j] = getOpTypeComboIndex(posOps);
      }
    }
  }

  if (backtraceMatrix) return { scoreMatrix, backtraceMatrix };
  return scoreMatrix;
}

const OP_TYPE_COMBO_MAP: Record<number, OpType[]> = (() => {
  const map: Record<number, OpType[]> = {};
  let idx = 0;
  for (let r = 1; r <= OP_TYPES.length; r++) {
    for (const combo of combinations(OP_TYPES, r)) {
      map[idx++] = combo;
    }
  }
  return map;
})();

export function backtraceAlignments(
  refTokens: string[],
  hypTokens: string[],
  refNorm: string[],
  hypNorm: string[],
): import("./types").TokenAlignment[] {
  const { backtraceMatrix } = computeErrorAlignDistanceMatrix(refNorm, hypNorm, true) as {
    scoreMatrix: number[][];
    backtraceMatrix: number[][];
  };

  const alignments: import("./types").TokenAlignment[] = [];
  let i = hypNorm.length;
  let j = refNorm.length;

  while (i > 0 || j > 0) {
    if (i === 0) {
      alignments.unshift({
        op: "DELETE",
        refTokenIndex: j - 1,
        hypTokenIndex: null,
        refText: refTokens[j - 1] ?? null,
        hypText: null,
      });
      j--;
      continue;
    }
    if (j === 0) {
      alignments.unshift({
        op: "INSERT",
        refTokenIndex: null,
        hypTokenIndex: i - 1,
        refText: null,
        hypText: hypTokens[i - 1] ?? null,
      });
      i--;
      continue;
    }

    const combo = OP_TYPE_COMBO_MAP[backtraceMatrix[i][j]] ?? ["MATCH"];
    const op = combo[0];

    if (op === "MATCH" || op === "SUBSTITUTE") {
      alignments.unshift({
        op,
        refTokenIndex: j - 1,
        hypTokenIndex: i - 1,
        refText: refTokens[j - 1] ?? null,
        hypText: hypTokens[i - 1] ?? null,
      });
      i--;
      j--;
    } else if (op === "INSERT") {
      alignments.unshift({
        op: "INSERT",
        refTokenIndex: null,
        hypTokenIndex: i - 1,
        refText: null,
        hypText: hypTokens[i - 1] ?? null,
      });
      i--;
    } else {
      alignments.unshift({
        op: "DELETE",
        refTokenIndex: j - 1,
        hypTokenIndex: null,
        refText: refTokens[j - 1] ?? null,
        hypText: null,
      });
      j--;
    }
  }

  return alignments;
}

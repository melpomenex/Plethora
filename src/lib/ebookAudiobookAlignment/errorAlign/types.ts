/**
 * Error-alignment types — adapted from Storyteller MIT-licensed
 * libraries/align/src/errorAlign/ (see ATTRIBUTION.md).
 */

export type OpType = "MATCH" | "INSERT" | "DELETE" | "SUBSTITUTE";

export type Slice = [number, number];

export class Alignment {
  constructor(
    public opType: OpType,
    public refIndex: number | null,
    public hypIndex: number | null,
    public refText: string | null,
    public hypText: string | null,
  ) {}
}

export interface TokenAlignment {
  op: OpType;
  refTokenIndex: number | null;
  hypTokenIndex: number | null;
  refText: string | null;
  hypText: string | null;
}

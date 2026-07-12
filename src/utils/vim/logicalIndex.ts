export interface LogicalToken {
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
  kind: "word" | "punct";
}

export interface LogicalBlock {
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
  tokens: LogicalToken[];
}

export interface LogicalRegion<TId extends string | number> {
  id: TId;
  text: string;
  blocks: LogicalBlock[];
  tokens: LogicalToken[];
}

export function normalizeLogicalText(value: string): string {
  return value.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

export function buildLogicalRegion<TId extends string | number>(
  id: TId,
  blockTexts: readonly string[],
): LogicalRegion<TId> {
  const blocks: LogicalBlock[] = [];
  const tokens: LogicalToken[] = [];
  let documentOffset = 0;

  for (const raw of blockTexts) {
    const text = normalizeLogicalText(raw);
    if (!text) continue;
    const blockStart = documentOffset;
    const blockTokens = tokenizeLogicalText(text, blockStart, tokens.length);
    tokens.push(...blockTokens);
    documentOffset += text.length;
    blocks.push({
      index: blocks.length,
      startOffset: blockStart,
      endOffset: documentOffset,
      text,
      tokens: blockTokens,
    });
    documentOffset += 1;
  }

  return { id, text: blocks.map((block) => block.text).join("\n"), blocks, tokens };
}

export function tokenizeLogicalText(text: string, baseOffset = 0, baseIndex = 0): LogicalToken[] {
  const tokens: LogicalToken[] = [];
  const matcher = /\w+|[^\s\w]+/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text))) {
    const value = match[0];
    tokens.push({
      index: baseIndex + tokens.length,
      startOffset: baseOffset + match.index,
      endOffset: baseOffset + match.index + value.length,
      text: value,
      kind: /^\w+$/u.test(value) ? "word" : "punct",
    });
  }
  return tokens;
}

export class BoundedRegionCache<K, V> {
  private readonly values = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Cache capacity must be positive");
  }
  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
  delete(key: K): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  has(key: K): boolean { return this.values.has(key); }
  get size(): number { return this.values.size; }
}

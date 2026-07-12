import type { DocumentVimMotion } from "./documentAdapter";
import type { LogicalRegion } from "./logicalIndex";

export interface LogicalCursor {
  region: number;
  token: number;
}

export interface LogicalMotionSource {
  firstRegion: number;
  lastRegion: number;
  region(index: number, signal?: AbortSignal): Promise<LogicalRegion<number> | null>;
}

export async function moveLogicalCursor(
  source: LogicalMotionSource,
  from: LogicalCursor,
  motion: DocumentVimMotion,
  count = 1,
  desiredColumn: number | null = null,
  signal?: AbortSignal,
): Promise<{ cursor: LogicalCursor; desiredColumn: number | null }> {
  let cursor = { ...from };
  let column = desiredColumn;
  const iterations = Math.max(1, Math.trunc(count));
  for (let step = 0; step < iterations; step += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const moved = await moveOnce(source, cursor, motion, column, signal);
    cursor = moved.cursor;
    column = moved.desiredColumn;
  }
  return { cursor, desiredColumn: column };
}

async function moveOnce(
  source: LogicalMotionSource,
  from: LogicalCursor,
  motion: DocumentVimMotion,
  desiredColumn: number | null,
  signal?: AbortSignal,
): Promise<{ cursor: LogicalCursor; desiredColumn: number | null }> {
  if (motion === "document-start") return { cursor: await edgeCursor(source, source.firstRegion, false, signal), desiredColumn: 0 };
  if (motion === "document-end") return { cursor: await edgeCursor(source, source.lastRegion, true, signal), desiredColumn: null };
  const region = await source.region(from.region, signal);
  if (!region?.tokens.length) return { cursor: from, desiredColumn };
  const tokenIndex = clamp(from.token, 0, region.tokens.length - 1);
  const blockIndex = region.blocks.findIndex((block) => block.tokens.some((token) => token.index === tokenIndex));
  const block = region.blocks[Math.max(0, blockIndex)];
  const indexInBlock = Math.max(0, block.tokens.findIndex((token) => token.index === tokenIndex));

  switch (motion) {
    case "left": case "word-backward":
      return { cursor: await adjacentToken(source, from.region, tokenIndex, -1, signal), desiredColumn };
    case "right": case "word-forward": case "word-end":
      return { cursor: await adjacentToken(source, from.region, tokenIndex, 1, signal), desiredColumn };
    case "line-start":
      return { cursor: { region: from.region, token: block.tokens[0]?.index ?? tokenIndex }, desiredColumn: 0 };
    case "line-end":
      return { cursor: { region: from.region, token: block.tokens.at(-1)?.index ?? tokenIndex }, desiredColumn: block.tokens.length - 1 };
    case "line-up": case "line-down": {
      const direction = motion === "line-up" ? -1 : 1;
      const targetBlockIndex = blockIndex + direction;
      const column = desiredColumn ?? indexInBlock;
      if (targetBlockIndex >= 0 && targetBlockIndex < region.blocks.length) {
        const target = region.blocks[targetBlockIndex];
        return { cursor: { region: from.region, token: target.tokens[Math.min(column, target.tokens.length - 1)]?.index ?? tokenIndex }, desiredColumn: column };
      }
      const adjacentRegion = from.region + direction;
      if (adjacentRegion < source.firstRegion || adjacentRegion > source.lastRegion) return { cursor: from, desiredColumn: column };
      const next = await source.region(adjacentRegion, signal);
      if (!next?.blocks.length) return { cursor: from, desiredColumn: column };
      const target = direction > 0 ? next.blocks[0] : next.blocks.at(-1)!;
      return { cursor: { region: adjacentRegion, token: target.tokens[Math.min(column, target.tokens.length - 1)]?.index ?? 0 }, desiredColumn: column };
    }
    case "paragraph-backward": case "paragraph-forward": {
      const direction = motion === "paragraph-backward" ? -1 : 1;
      const targetBlockIndex = blockIndex + direction;
      if (targetBlockIndex >= 0 && targetBlockIndex < region.blocks.length) {
        return { cursor: { region: from.region, token: region.blocks[targetBlockIndex].tokens[0]?.index ?? tokenIndex }, desiredColumn: 0 };
      }
      const adjacentRegion = from.region + direction;
      if (adjacentRegion < source.firstRegion || adjacentRegion > source.lastRegion) return { cursor: from, desiredColumn };
      const next = await source.region(adjacentRegion, signal);
      const target = direction > 0 ? next?.blocks[0] : next?.blocks.at(-1);
      return { cursor: target ? { region: adjacentRegion, token: target.tokens[0]?.index ?? 0 } : from, desiredColumn: 0 };
    }
  }
}

async function adjacentToken(source: LogicalMotionSource, regionIndex: number, tokenIndex: number, delta: -1 | 1, signal?: AbortSignal): Promise<LogicalCursor> {
  const region = await source.region(regionIndex, signal);
  if (!region) return { region: regionIndex, token: tokenIndex };
  const next = tokenIndex + delta;
  if (next >= 0 && next < region.tokens.length) return { region: regionIndex, token: next };
  const adjacent = regionIndex + delta;
  if (adjacent < source.firstRegion || adjacent > source.lastRegion) return { region: regionIndex, token: tokenIndex };
  return edgeCursor(source, adjacent, delta < 0, signal);
}

async function edgeCursor(source: LogicalMotionSource, regionIndex: number, atEnd: boolean, signal?: AbortSignal): Promise<LogicalCursor> {
  const region = await source.region(regionIndex, signal);
  return { region: regionIndex, token: atEnd ? Math.max(0, (region?.tokens.length ?? 1) - 1) : 0 };
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

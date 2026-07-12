import type { DocumentMotionRequest } from "./documentAdapter";
import type { EpubDocumentPosition, PdfDocumentPosition } from "./documentModel";
import type { EpubLogicalIndex, IndexedEpubSection } from "./epubLogicalIndex";
import type { LogicalRegion } from "./logicalIndex";
import { moveLogicalCursor, type LogicalMotionSource } from "./logicalMotion";
import type { PdfLogicalIndex } from "./pdfLogicalIndex";

export async function moveEpubPosition(
  index: EpubLogicalIndex,
  position: EpubDocumentPosition,
  request: DocumentMotionRequest,
  firstSpineIndex: number,
  lastSpineIndex: number,
): Promise<{ position: EpubDocumentPosition; desiredX: number | null }> {
  const current = await index.section(position.spineIndex, request.signal);
  if (!current) return { position, desiredX: request.desiredX };
  const token = tokenAtOffset(current, position.textOffset);
  const source: LogicalMotionSource = {
    firstRegion: firstSpineIndex,
    lastRegion: lastSpineIndex,
    region: (spineIndex, signal) => index.section(spineIndex, signal),
  };
  const moved = await moveLogicalCursor(source, { region: position.spineIndex, token }, request.motion, request.count, request.desiredX, request.signal);
  const target = await index.section(moved.cursor.region, request.signal);
  if (!target?.tokens.length) return { position, desiredX: moved.desiredColumn };
  const targetToken = target.tokens[Math.min(moved.cursor.token, target.tokens.length - 1)];
  const block = target.blocks.find((candidate) => candidate.tokens.some((candidateToken) => candidateToken.index === targetToken.index));
  const boundary = target.cfiBoundaries.find((candidate) => candidate.blockIndex === block?.index);
  const tokenCfi = target.tokenCfis.get(targetToken.index);
  return {
    position: {
      kind: "epub",
      spineIndex: moved.cursor.region,
      cfi: tokenCfi?.startCfi ?? boundary?.startCfi ?? position.cfi,
      textOffset: targetToken.startOffset,
      affinity: request.motion.includes("backward") || request.motion === "left" ? "backward" : "forward",
      quote: quoteForToken(target, targetToken.index),
    },
    desiredX: moved.desiredColumn,
  };
}

export async function movePdfPosition(
  index: PdfLogicalIndex,
  position: PdfDocumentPosition,
  request: DocumentMotionRequest,
  pageCount: number,
): Promise<{ position: PdfDocumentPosition; desiredX: number | null }> {
  const source: LogicalMotionSource = {
    firstRegion: 1,
    lastRegion: pageCount,
    region: (pageNumber, signal) => index.page(pageNumber, signal),
  };
  const moved = await moveLogicalCursor(source, { region: position.pageNumber, token: position.itemIndex }, request.motion, request.count, request.desiredX, request.signal);
  const page = await index.page(moved.cursor.region, request.signal);
  const token = page.tokens[Math.min(moved.cursor.token, Math.max(0, page.tokens.length - 1))];
  return {
    position: {
      kind: "pdf",
      pageNumber: moved.cursor.region,
      itemIndex: token?.index ?? 0,
      charOffset: token?.startOffset ?? 0,
      affinity: request.motion.includes("backward") || request.motion === "left" ? "backward" : "forward",
      quote: token ? quoteForToken(page, token.index) : position.quote,
    },
    desiredX: moved.desiredColumn,
  };
}

function tokenAtOffset(region: LogicalRegion<number>, offset: number): number {
  const found = region.tokens.find((token) => offset >= token.startOffset && offset <= token.endOffset);
  if (found) return found.index;
  const next = region.tokens.find((token) => token.startOffset >= offset);
  return next?.index ?? Math.max(0, region.tokens.length - 1);
}

function quoteForToken(region: LogicalRegion<number>, tokenIndex: number) {
  const token = region.tokens[tokenIndex];
  if (!token) return undefined;
  return {
    exact: token.text,
    prefix: region.text.slice(Math.max(0, token.startOffset - 24), token.startOffset),
    suffix: region.text.slice(token.endOffset, token.endOffset + 24),
  };
}

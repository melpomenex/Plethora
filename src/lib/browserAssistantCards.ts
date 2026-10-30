import * as db from "./database";

function sourceId(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
  return value.trim();
}

async function resolveSource(args: Record<string, unknown>) {
  const requestedDocument = sourceId(args, "document_id");
  const explicitExtract = sourceId(args, "extract_id");
  const namespacedExtract = requestedDocument?.startsWith("extract:")
    ? requestedDocument.slice("extract:".length) : undefined;
  if (namespacedExtract === "" || (namespacedExtract && explicitExtract && namespacedExtract !== explicitExtract)) {
    throw new Error("The selected source extract is invalid.");
  }
  const extractId = explicitExtract ?? namespacedExtract;
  let documentId = namespacedExtract !== undefined ? undefined : requestedDocument;
  if (extractId) {
    const extract = await db.getExtract(extractId);
    if (!extract || extract._deleted || (documentId && documentId !== extract.document_id)) {
      throw new Error("The source extract is unavailable or does not belong to the selected document.");
    }
    documentId = extract.document_id;
  }
  if (documentId) {
    const document = await db.getDocument(documentId);
    if (!document || document._deleted) throw new Error("The source document is unavailable.");
  }
  return { documentId, extractId };
}

function sourceReference(value: unknown, documentId?: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source passage.");
  const source = value as Record<string, unknown>;
  const excerpt = typeof source.excerpt === "string" ? Array.from(source.excerpt.trim()).slice(0, 300).join("") : "";
  if (!documentId || source.document_id !== documentId || !excerpt) throw new Error("The source passage does not match the document.");
  return JSON.stringify({
    version: 1, document_id: documentId, excerpt,
    locator: {
      kind: typeof source.kind === "string" ? source.kind : "html", textQuote: excerpt,
      ...(typeof source.page_number === "number" ? { pageNumber: source.page_number } : {}),
      ...(typeof source.scroll_percent === "number" ? { scrollPercent: source.scroll_percent } : {}),
      ...(typeof source.time_seconds === "number" ? { timeSeconds: source.time_seconds } : {}),
      ...(typeof source.segment_id === "string" ? { segmentId: source.segment_id } : {}),
    },
    section_label: source.section_label ?? null, captured_at: new Date().toISOString(),
  });
}

/** Resolve the UI's extract namespace before writing a card in browser storage. */
export async function createBrowserAssistantCard(kind: "qa" | "cloze" | "flashcard", args: Record<string, unknown>) {
  const { documentId, extractId } = await resolveSource(args);
  const source = sourceReference(args.source, documentId);
  const question = kind === "cloze" ? args.text : args.question;
  const answer = kind !== "cloze" ? args.answer : undefined;
  if (typeof question !== "string" || !question.trim() ||
      (kind !== "cloze" && (typeof answer !== "string" || !answer.trim()))) {
    throw new Error("The card is missing required content.");
  }
  const item = await db.createLearningItem({
    document_id: documentId,
    extract_id: extractId,
    item_type: kind,
    question,
    answer: typeof answer === "string" ? answer : undefined,
    cloze_text: kind === "cloze" ? question : undefined,
    source_reference: extractId ? undefined : source,
    acceptance_id: sourceId(args, "acceptance_id"),
    proposal_id: sourceId(args, "proposal_id"),
    image_asset_ids: Array.isArray(args.image_asset_ids) ? args.image_asset_ids.filter((id): id is string => typeof id === "string") : undefined,
    tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  }, { documentRevision: sourceId(args, "source_revision"), extractRevision: sourceId(args, "extract_revision") });
  return { success: true, id: item.id, document_id: item.document_id, extract_id: item.extract_id, type: kind };
}

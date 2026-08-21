import { getDocument, getDocuments, updateDocument } from "../../api/documents";
import { getExtracts } from "../../api/extracts";
import { getExtract, updateExtract, type Extract as ApiExtract } from "../../api/extracts";
import {
  getLearningItem,
  updateLearningItemTags,
  type LearningItem as ApiLearningItem,
} from "../../api/learning-items";
import { getImageAssetById, listImageAssets, updateImageAssetMetadata } from "../../api/image-registry";
import { isTauri } from "../tauri";
import { runSmartTagging } from "../ai/tasks/definitions/smartTaggingTask";
import { normalizeForComparison } from "./normalization";
import {
  BROWSER_CAPTURE_CONTEXT_VERSION,
  buildDocumentTarget,
  buildExtractTarget,
  buildImageAssetTarget,
  buildLearningItemTarget,
  browserOrganizationFingerprint,
  confidenceBand,
  rankInheritedSourceTags,
  targetEvidence,
  toOrganizationDetails,
  withOrganizationContainer,
  type BrowserOrganizationMetadata,
  type BrowserOrganizationTarget,
  type BrowserOrganizationTagRecord,
} from "./browserImportOrganization";
import type { Document, Extract, LearningItem, SmartTagDetail } from "../../types/document";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { publishItemTagsUpdated } from "../tagEditing/itemTagEvents";

function asDocumentExtract(extract: ApiExtract): Extract {
  return {
    id: extract.id,
    documentId: extract.document_id,
    content: extract.content || "",
    pageTitle: extract.page_title,
    pageNumber: extract.page_number,
    selectionContext: extract.selection_context,
    progressiveDisclosureLevel: extract.progressive_disclosure_level || 0,
    maxDisclosureLevel: extract.max_disclosure_level || 0,
    dateCreated: extract.date_created,
    dateModified: extract.date_modified,
    tags: extract.tags || [],
    category: extract.category,
    learningItems: [],
  };
}

function asDocumentLearningItem(item: ApiLearningItem): LearningItem {
  return {
    id: item.id,
    extractId: item.extract_id,
    documentId: item.document_id,
    itemType: item.item_type.toLowerCase() as LearningItem["itemType"],
    question: item.question,
    answer: item.answer,
    clozeText: item.cloze_text,
    difficulty: Math.max(1, Math.min(5, Math.round(item.difficulty || 1))) as LearningItem["difficulty"],
    interval: item.interval || 0,
    easeFactor: item.ease_factor || 2.5,
    dueDate: item.due_date,
    dateCreated: item.date_created,
    dateModified: item.date_modified,
    lastReviewDate: item.last_review_date,
    reviewCount: item.review_count || 0,
    lapses: item.lapses || 0,
    state: item.state.toLowerCase() as LearningItem["state"],
    isSuspended: Boolean(item.is_suspended),
    tags: item.tags || [],
    interactionMetadata: item.interaction_metadata,
    imageAssetIds: item.image_asset_ids,
  };
}

export async function loadBrowserOrganizationTarget(
  targetType: BrowserOrganizationTarget["targetType"],
  targetId: string,
): Promise<BrowserOrganizationTarget | null> {
  const sourceDocument = useDocumentStore.getState().documents.find((doc) => doc.id === targetId);

  if (targetType === "document") {
    const document = await getDocument(targetId);
    return document ? buildDocumentTarget(document) : null;
  }

  const extract = targetType === "extract" ? await getExtract(targetId) : null;
  if (extract) {
    const source = await getDocument(extract.document_id);
    return buildExtractTarget(asDocumentExtract(extract), source || sourceDocument || undefined);
  }

  if (targetType === "image-asset") {
    return loadImageAssetTarget(targetId);
  }

  const item = await getLearningItem(targetId);
  if (!item) return null;
  const source = item.document_id ? await getDocument(item.document_id) : sourceDocument;
  const itemExtract = item.extract_id ? await getExtract(item.extract_id) : null;
  return buildLearningItemTarget(
    asDocumentLearningItem(item),
    source || undefined,
    itemExtract ? asDocumentExtract(itemExtract) : undefined,
  );
}

async function loadImageAssetTarget(targetId: string): Promise<BrowserOrganizationTarget | null> {
  const asset = await getImageAssetById(targetId);
  return asset ? buildImageAssetTarget(asset) : null;
}

function libraryTagCandidates(): Array<{ name: string; itemCount: number }> {
  const counts = new Map<string, number>();
  for (const document of useDocumentStore.getState().documents) {
    for (const tag of document.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, itemCount]) => ({ name, itemCount }));
}

function existingOrganizationDetails(target: BrowserOrganizationTarget): SmartTagDetail[] {
  if (target.organization?.details) return [...target.organization.details];
  return [];
}

function mergeOrganizationTags(
  target: BrowserOrganizationTarget,
  generated: SmartTagDetail[],
  manualTags: string[],
  dismissedTags: string[],
): { tags: string[]; details: BrowserOrganizationTagRecord[] } {
  const existingDetails = existingOrganizationDetails(target);
  const inherited = rankInheritedSourceTags(target.sourceTags, targetEvidence(target));
  const dismissed = new Set(dismissedTags.map(normalizeForComparison));
  const manual = new Set(manualTags.map(normalizeForComparison));
  const details: SmartTagDetail[] = [];
  const seen = new Set<string>();
  const add = (detail: SmartTagDetail) => {
    const normalized = normalizeForComparison(detail.tag);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    details.push(detail);
  };

  for (const tag of manualTags) {
    const prior = existingDetails.find((detail) => normalizeForComparison(detail.tag) === normalizeForComparison(tag));
    add(prior || {
      tag,
      provenance: "manual",
      confidence: 1,
      reason: "User assigned",
      assignedAt: new Date().toISOString(),
    });
  }

  for (const detail of generated) {
    const normalized = normalizeForComparison(detail.tag);
    if (!manual.has(normalized) && !dismissed.has(normalized)) add(detail);
  }

  for (const tag of inherited) {
    const normalized = normalizeForComparison(tag);
    if (manual.has(normalized) || dismissed.has(normalized)) continue;
    add({
      tag,
      provenance: "source-inherited",
      confidence: 0.78,
      reason: "Inherited from browser source evidence",
      assignedAt: new Date().toISOString(),
      sourceDocumentId: target.sourceDocumentId,
    });
  }

  for (const detail of existingDetails) {
    if (detail.dismissed) add(detail);
  }

  const tags = details.filter((detail) => !detail.dismissed).map((detail) => detail.tag);
  return { tags, details: toOrganizationDetails(details, target.sourceDocumentId) };
}

function organizationResult(
  target: BrowserOrganizationTarget,
  details: BrowserOrganizationTagRecord[],
  fallbackUsed: boolean,
): BrowserOrganizationMetadata {
  const active = details.filter((detail) => !detail.dismissed);
  const bestConfidence = active.reduce((best, detail) => Math.max(best, detail.confidence), 0);
  const band = confidenceBand(bestConfidence);
  const contextReduced = target.captureContext?.reduced === true;
  const status = active.length === 0 || band === "low" ? "needs-review" : "completed";
  const reviewReason = active.length === 0
    ? "no-result"
    : band === "low"
      ? "low-confidence"
      : contextReduced
        ? "context-reduced"
        : undefined;
  return {
    schemaVersion: BROWSER_CAPTURE_CONTEXT_VERSION,
    status,
    confidenceBand: band,
    ...(reviewReason ? { reviewReason } : {}),
    fingerprint: browserOrganizationFingerprint([
      target.itemType,
      target.targetId,
      target.content,
      target.captureContext?.sourceUrl,
      target.tags,
    ]),
    queuedAt: target.organization?.queuedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    contextReduced,
    details,
    manualTags: target.organization?.manualTags,
    dismissedTags: target.organization?.dismissedTags,
    ...(fallbackUsed ? { error: "AI unavailable; local classifier used" } : {}),
  };
}

async function persistTarget(
  target: BrowserOrganizationTarget,
  tags: string[],
  details: BrowserOrganizationTagRecord[],
  organization: BrowserOrganizationMetadata,
): Promise<void> {
  if (target.targetType === "image-asset") {
    await persistImageAssetTarget(target, tags, details, organization);
    return;
  }
  if (target.targetType === "document") {
    const document = await getDocument(target.targetId);
    if (!document) return;
    const metadata = {
      ...(document.metadata || {}),
      smartTagDetails: details,
      organization,
    };
    const updated = await updateDocument(document.id, { ...document, tags, metadata });
    useDocumentStore.setState((state) => ({
      documents: state.documents.map((item) => item.id === updated.id ? updated : item),
      currentDocument: state.currentDocument?.id === updated.id ? updated : state.currentDocument,
    }));
    publishItemTagsUpdated({ itemType: "document", id: document.id, tags });
    return;
  }

  if (target.targetType === "extract") {
    const extract = await getExtract(target.targetId);
    if (!extract) return;
    await updateExtract({
      id: extract.id,
      tags,
      selection_context: withOrganizationContainer(extract.selection_context, {
        captureContext: target.captureContext,
        organization,
      }),
    });
    publishItemTagsUpdated({ itemType: "extract", id: extract.id, tags });
    return;
  }

  const item = await getLearningItem(target.targetId);
  if (!item) return;
  const interactionMetadata = {
    ...(item.interaction_metadata || {}),
    ...withOrganizationContainer(item.interaction_metadata, {
      captureContext: target.captureContext,
      organization,
    }),
  };
  if (isTauri()) {
    await updateLearningItemTags(item.id, tags, interactionMetadata);
  } else {
    await updateLearningItemTags(item.id, tags, interactionMetadata);
  }
  publishItemTagsUpdated({ itemType: "learning-item", id: item.id, tags });
}

async function persistImageAssetTarget(
  target: BrowserOrganizationTarget,
  tags: string[],
  details: BrowserOrganizationTagRecord[],
  organization: BrowserOrganizationMetadata,
): Promise<void> {
  const asset = await getImageAssetById(target.targetId);
  if (!asset) return;
  const metadata = {
    ...(asset.metadata || {}),
    ...withOrganizationContainer(asset.metadata, {
      captureContext: target.captureContext,
      organization,
    }),
    ...(target.captureProvenance ? { captureProvenance: target.captureProvenance } : {}),
    tags,
    ...(details.length ? { smartTagDetails: details } : {}),
  };
  await updateImageAssetMetadata(target.targetId, metadata);
  publishItemTagsUpdated({ itemType: "image-asset", id: target.targetId, tags });
}

export async function organizeBrowserTarget(target: BrowserOrganizationTarget): Promise<void> {
  const settings = useSettingsStore.getState().settings.documents.smartTagging ?? {
    enabled: true,
    mode: "automatic" as const,
    maxTagsPerDocument: 6,
    preferExistingTags: true,
  };
  if (!settings.enabled) return;

  const existingDetails = existingOrganizationDetails(target);
  const organizationManual = target.organization?.manualTags || [];
  const manualTags = Array.from(new Set([
    ...organizationManual,
    ...target.tags.filter((tag) => {
      const detail = existingDetails.find((item) => normalizeForComparison(item.tag) === normalizeForComparison(tag));
      return !detail || detail.provenance === "manual";
    }),
  ]));
  const dismissedTags = Array.from(new Set([
    ...(target.organization?.dismissedTags || []),
    ...existingDetails.filter((detail) => detail.dismissed).map((detail) => detail.tag),
  ]));
  const candidates = libraryTagCandidates();
  const result = await runSmartTagging({
    title: target.title,
    author: target.author,
    category: target.category,
    fileType: target.fileType,
    headings: target.headings,
    content: target.content,
    candidateExistingTags: candidates.map((candidate) => candidate.name),
    existingLibraryTagsList: candidates,
    manualTags,
    dismissedTags,
    maxTagsPerDocument: settings.maxTagsPerDocument || 6,
    sourceUrl: target.captureContext?.sourceUrl,
    sourceDomain: target.captureContext?.domain,
    nearbyText: target.captureContext?.nearbyText,
    captionAltText: target.captureContext?.captionAltText,
    sourceTags: target.sourceTags,
    sourceDocumentId: target.sourceDocumentId,
  });
  const merged = mergeOrganizationTags(target, result.tagDetails, manualTags, dismissedTags);
  const organization = organizationResult(target, merged.details, result.fallbackUsed);
  organization.manualTags = manualTags;
  organization.dismissedTags = dismissedTags;
  const persistedTags = settings.mode === "automatic" ? merged.tags : target.tags;
  await persistTarget(target, persistedTags, merged.details, organization);
}

export async function listBrowserOrganizationTargets(): Promise<BrowserOrganizationTarget[]> {
  const [documentsRaw, extractsRaw, itemsRaw, assetsRaw] = await Promise.all([
    getDocuments(),
    getExtracts(),
    import("../../api/learning-items").then(({ getAllLearningItems }) => getAllLearningItems()),
    listImageAssets(),
  ]);
  // Some web/test adapters have no learning-item list yet. Treat an absent or
  // malformed collection as empty so startup reconciliation stays best-effort.
  const documents = Array.isArray(documentsRaw) ? documentsRaw : [];
  const extracts = Array.isArray(extractsRaw) ? extractsRaw : [];
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const assets = Array.isArray(assetsRaw) ? assetsRaw : [];
  const sourceById = new Map(documents.map((document) => [document.id, document]));
  const targets: BrowserOrganizationTarget[] = [];
  for (const document of documents) {
    const target = buildDocumentTarget(document);
    if (target) targets.push(target);
  }
  for (const extract of extracts) {
    const source = sourceById.get(extract.document_id);
    const target = buildExtractTarget(asDocumentExtract(extract), source);
    if (target) targets.push(target);
  }
  for (const item of items) {
    const source = item.document_id ? sourceById.get(item.document_id) : undefined;
    const extract = item.extract_id ? extracts.find((candidate) => candidate.id === item.extract_id) : undefined;
    const target = buildLearningItemTarget(
      asDocumentLearningItem(item),
      source,
      extract ? asDocumentExtract(extract) : undefined,
    );
    if (target) targets.push(target);
  }
  for (const asset of assets) {
    const target = buildImageAssetTarget(asset);
    if (target) targets.push(target);
  }
  return targets;
}

export async function updateBrowserOrganizationReview(
  target: BrowserOrganizationTarget,
  action: "confirm" | "dismiss" | "retry",
): Promise<void> {
  const latest = await loadBrowserOrganizationTarget(target.targetType, target.targetId) || target;
  const now = new Date().toISOString();
  const organization: BrowserOrganizationMetadata = {
    ...(latest.organization || {
      schemaVersion: BROWSER_CAPTURE_CONTEXT_VERSION,
      confidenceBand: "none" as const,
      fingerprint: browserOrganizationFingerprint([
        latest.itemType,
        latest.targetId,
        latest.content,
        latest.captureContext?.sourceUrl,
      ]),
    }),
    status: action === "confirm" ? "completed" : action === "dismiss" ? "dismissed" : "queued",
    ...(action === "retry" ? {
      queuedAt: now,
      error: undefined,
      reviewReason: undefined,
    } : {}),
    ...(action === "confirm" ? { userConfirmedAt: now, reviewReason: undefined } : {}),
    ...(action === "dismiss" ? { dismissedAt: now, reviewReason: "user-requested" as const } : {}),
  };
  await persistTarget(latest, latest.tags, latest.organization?.details || [], organization);
}

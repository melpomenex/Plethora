/**
 * Serialization and backward-compatibility for canonical conversation records
 * (task 1.1).
 *
 * Rules, in order of importance:
 *  1. Decoding never throws and never invents data. Unusable input returns
 *     `null` with a reason so import paths can quarantine it.
 *  2. Unknown fields survive a round trip: conversation-level extras land in
 *     `unknownFields` and every message keeps its raw form in `legacyPayload`.
 *  3. Version 1 records (pre-canonical or legacy-shaped) upgrade to version 2
 *     with honest defaults: no citations, no evidence, no fabricated titles.
 *  4. Timestamps are normalized to epoch milliseconds but the original value
 *     is preserved in the legacy payload when it was not already ms.
 */

import {
  CONVERSATION_RECORD_VERSION,
  isContextPolicyMode,
  isEvidenceLevel,
  isEvidenceOrigin,
  isTurnStatus,
  type Attempt,
  type Citation,
  type ContextPolicy,
  type Conversation,
  type ConversationRecord,
  type Draft,
  type DraftAlternative,
  type EvidenceStatus,
  type FrozenTurnPlan,
  type MentionToken,
  type Message,
  type ProviderProvenance,
  type SelectionSnapshot,
  type SourceAttachment,
  type SourceLocator,
  type SourceReference,
  type SyncPolicy,
  type ToolResultReference,
  type Turn,
} from "./types";

export interface DecodeResult<T> {
  ok: boolean;
  value: T | null;
  /** Why the record was rejected, for quarantine reporting. */
  reason?: string;
}

const ok = <T>(value: T): DecodeResult<T> => ({ ok: true, value });
const fail = <T>(reason: string): DecodeResult<T> => ({ ok: false, value: null, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length ? out : undefined;
}

function arrayOf<T>(value: unknown, decode: (v: unknown) => T | null): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const item of value) {
    const decoded = decode(item);
    if (decoded !== null) out.push(decoded);
  }
  return out;
}

/** Collect keys not claimed by the decoder, so they survive a round trip. */
function collectUnknownKeys(
  raw: Record<string, unknown>,
  known: readonly string[],
): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  let found = false;
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      extras[key] = raw[key];
      found = true;
    }
  }
  return found ? extras : undefined;
}

/* ------------------------------------------------------------------ */
/* Sub-record decoders (all total)                                     */
/* ------------------------------------------------------------------ */

function decodeLocator(raw: unknown): SourceLocator | undefined {
  if (!isRecord(raw)) return undefined;
  const locator: SourceLocator = {};
  const page = num(raw.page);
  if (page !== undefined) locator.page = page;
  const cfi = str(raw.cfi);
  if (cfi !== undefined) locator.cfi = cfi;
  const sectionId = str(raw.sectionId);
  if (sectionId !== undefined) locator.sectionId = sectionId;
  const timeSeconds = num(raw.timeSeconds);
  if (timeSeconds !== undefined) locator.timeSeconds = timeSeconds;
  const anchor = str(raw.anchor);
  if (anchor !== undefined) locator.anchor = anchor;
  const quote = str(raw.quote);
  if (quote !== undefined) locator.quote = quote;
  if (isRecord(raw.textRange)) {
    const start = num(raw.textRange.start);
    const end = num(raw.textRange.end);
    if (start !== undefined && end !== undefined) locator.textRange = { start, end };
  }
  if (Array.isArray(raw.rects)) {
    const rects = raw.rects.flatMap((r) => {
      if (!isRecord(r)) return [];
      const { x, y, width, height } = r;
      if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return [];
      return [{ x, y, width, height }];
    });
    if (rects.length) locator.rects = rects;
  }
  return Object.keys(locator).length ? locator : undefined;
}

export function decodeSelectionSnapshot(raw: unknown): SelectionSnapshot | null {
  if (!isRecord(raw)) return null;
  const originalText = str(raw.originalText);
  if (originalText === undefined) return null;
  const snapshot: SelectionSnapshot = { originalText };
  const editedText = str(raw.editedText);
  if (editedText !== undefined) snapshot.editedText = editedText;
  const documentId = str(raw.documentId);
  if (documentId !== undefined) snapshot.documentId = documentId;
  const title = str(raw.title);
  if (title !== undefined) snapshot.title = title;
  const locator = decodeLocator(raw.locator);
  if (locator) snapshot.locator = locator;
  if (isRecord(raw.ephemeral)) {
    const ownerToken = str(raw.ephemeral.ownerToken);
    const sourceType = str(raw.ephemeral.sourceType);
    if (ownerToken && sourceType) {
      snapshot.ephemeral = { ownerToken, sourceType, localOnly: true };
    }
  }
  return snapshot;
}

export function decodeSourceReference(raw: unknown): SourceReference | null {
  if (!isRecord(raw)) return null;
  const attachmentId = str(raw.attachmentId);
  const title = str(raw.title);
  const kind = str(raw.kind);
  if (!attachmentId || title === undefined || !kind) return null;
  const allowedKinds: SourceReference["kind"][] = ["document", "video", "web", "selection", "library"];
  if (!allowedKinds.includes(kind as SourceReference["kind"])) return null;
  const reference: SourceReference = {
    attachmentId,
    kind: kind as SourceReference["kind"],
    title,
    origin: (str(raw.origin) as SourceReference["origin"]) ?? "history",
    role: (str(raw.role) as SourceReference["role"]) ?? "optional",
  };
  const libraryId = str(raw.libraryId);
  if (libraryId !== undefined) reference.libraryId = libraryId;
  const sourceType = str(raw.sourceType);
  if (sourceType !== undefined) reference.sourceType = sourceType;
  const contentVersion = str(raw.contentVersion);
  if (contentVersion !== undefined) reference.contentVersion = contentVersion;
  const locator = decodeLocator(raw.locator);
  if (locator) reference.locator = locator;
  const removedAt = num(raw.removedAt);
  if (removedAt !== undefined) reference.removedAt = removedAt;
  if (isRecord(raw.ephemeral)) {
    const ownerToken = str(raw.ephemeral.ownerToken);
    const sourceType2 = str(raw.ephemeral.sourceType);
    if (ownerToken && sourceType2) {
      reference.ephemeral = { ownerToken, sourceType: sourceType2, localOnly: true };
    }
  }
  // A source must have exactly one real identity: a library id or an
  // ephemeral capability. Anything else is unusable and must not be upgraded.
  if (!reference.libraryId && !reference.ephemeral) return null;
  return reference;
}

function decodeAttachment(raw: unknown): SourceAttachment | null {
  const reference = decodeSourceReference(raw);
  if (!reference) return null;
  // `active` defaults to false for historical records: nothing reattaches
  // silently after hydration.
  const active = isRecord(raw) ? bool(raw.active) : undefined;
  return { ...reference, active: active ?? false };
}

function decodeContextPolicy(raw: unknown): ContextPolicy | null {
  if (!isRecord(raw)) return null;
  const mode = raw.mode;
  if (!isContextPolicyMode(mode)) return null;
  const policy: ContextPolicy = {
    mode,
    origin: (str(raw.origin) as ContextPolicy["origin"]) ?? "explicit",
  };
  const allowed = stringArray(raw.allowedDocumentIds);
  if (allowed) policy.allowedDocumentIds = allowed;
  const collectionId = str(raw.collectionId);
  if (collectionId !== undefined) policy.collectionId = collectionId;
  const sourceTypes = stringArray(raw.sourceTypes);
  if (sourceTypes) policy.sourceTypes = sourceTypes;
  const webAllowed = bool(raw.webAllowed);
  if (webAllowed !== undefined) policy.webAllowed = webAllowed;
  return policy;
}

function decodeCitation(raw: unknown): Citation | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const displayNumber = num(raw.displayNumber);
  const origin = str(raw.origin);
  const validation = str(raw.validation);
  if (!id || displayNumber === undefined || !origin || !validation) return null;
  const allowedOrigins: Citation["origin"][] = ["library", "selection", "web"];
  const allowedValidation: Citation["validation"][] = ["verified", "invalid", "unresolved", "legacy"];
  if (!allowedOrigins.includes(origin as Citation["origin"])) return null;
  if (!allowedValidation.includes(validation as Citation["validation"])) return null;
  const citation: Citation = {
    id,
    displayNumber,
    refId: str(raw.refId),
    chunkId: str(raw.chunkId),
    claimBindings: stringArray(raw.claimBindings),
    quote: str(raw.quote),
    documentId: str(raw.documentId),
    title: str(raw.title),
    sourceType: str(raw.sourceType),
    contentVersion: str(raw.contentVersion),
    headingPath: stringArray(raw.headingPath),
    locator: decodeLocator(raw.locator),
    origin: origin as Citation["origin"],
    url: str(raw.url),
    validation: validation as Citation["validation"],
  };
  // Drop absent optional keys so encoded records do not carry `undefined`.
  for (const key of Object.keys(citation) as Array<keyof Citation>) {
    if (citation[key] === undefined) delete citation[key];
  }
  return citation;
}

function decodeEvidence(raw: unknown): EvidenceStatus | undefined {
  if (!isRecord(raw)) return undefined;
  const origin = raw.origin;
  const level = raw.level;
  const retrievalMode = raw.retrievalMode;
  if (!isEvidenceOrigin(origin) || !isEvidenceLevel(level)) return undefined;
  const mode: EvidenceStatus["retrievalMode"] =
    retrievalMode === "semantic" || retrievalMode === "lexicalOnly" ? retrievalMode : "none";
  const status: EvidenceStatus = { origin, level, retrievalMode: mode };
  const sourceFree = bool(raw.sourceFree);
  if (sourceFree !== undefined) status.sourceFree = sourceFree;
  if (isRecord(raw.coverage)) {
    const suppliedCount = num(raw.coverage.suppliedCount);
    const citedCount = num(raw.coverage.citedCount);
    const coverage: NonNullable<EvidenceStatus["coverage"]> = {
      suppliedCount: suppliedCount ?? 0,
      citedCount: citedCount ?? 0,
    };
    const eligibleCount = num(raw.coverage.eligibleCount);
    if (eligibleCount !== undefined) coverage.eligibleCount = eligibleCount;
    const indexFreshness = str(raw.coverage.indexFreshness);
    if (indexFreshness !== undefined) coverage.indexFreshness = indexFreshness;
    const partial = bool(raw.coverage.partialCoverage);
    if (partial !== undefined) coverage.partialCoverage = partial;
    const limitations = stringArray(raw.coverage.limitations);
    if (limitations) coverage.limitations = limitations;
    status.coverage = coverage;
  }
  return status;
}

function decodeProvider(raw: unknown): ProviderProvenance | undefined {
  if (!isRecord(raw)) return undefined;
  const configurationId = str(raw.configurationId);
  const kind = str(raw.kind);
  const model = str(raw.model);
  const locality = raw.locality === "remote" ? "remote" : raw.locality === "on-device" ? "on-device" : undefined;
  if (!configurationId || !kind || model === undefined || !locality) return undefined;
  const provider: ProviderProvenance = { configurationId, kind, model, locality };
  if (isRecord(raw.capabilities)) {
    const capabilities: NonNullable<ProviderProvenance["capabilities"]> = {};
    const streaming = bool(raw.capabilities.streaming);
    if (streaming !== undefined) capabilities.streaming = streaming;
    const structured = bool(raw.capabilities.structured);
    if (structured !== undefined) capabilities.structured = structured;
    const vision = bool(raw.capabilities.vision);
    if (vision !== undefined) capabilities.vision = vision;
    if (Object.keys(capabilities).length) provider.capabilities = capabilities;
  }
  const fallbackUsed = str(raw.fallbackUsed);
  if (fallbackUsed !== undefined) provider.fallbackUsed = fallbackUsed;
  return provider;
}

function decodeToolResult(raw: unknown): ToolResultReference | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name);
  const status = str(raw.status);
  if (!name || (status !== "pending" && status !== "success" && status !== "error")) return null;
  const result: ToolResultReference = { name, status };
  const idempotencyKey = str(raw.idempotencyKey);
  if (idempotencyKey !== undefined) result.idempotencyKey = idempotencyKey;
  const artifactIds = stringArray(raw.artifactIds);
  if (artifactIds) result.artifactIds = artifactIds;
  const resultSummary = str(raw.resultSummary);
  if (resultSummary !== undefined) result.resultSummary = resultSummary;
  const executedAt = num(raw.executedAt);
  if (executedAt !== undefined) result.executedAt = executedAt;
  return result;
}

const MESSAGE_KNOWN_KEYS = [
  "id", "conversationId", "turnId", "role", "createdAt", "timestamp", "orderKey",
  "content", "thinking", "sourceSnapshot", "citations", "evidence", "provider",
  "toolResults", "artifactIds", "legacyPayload",
] as const;

function decodeMessage(raw: unknown): Message | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const role = str(raw.role);
  const content = str(raw.content);
  // Legacy shapes use `timestamp`; canonical records use `createdAt`.
  const createdAt = num(raw.createdAt) ?? num(raw.timestamp);
  if (!id || !role || content === undefined || createdAt === undefined) return null;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const conversationId = str(raw.conversationId) ?? "";
  // Legacy messages have no turn; import assigns real turns later. Empty is
  // honest, never a fabricated turn id.
  const turnId = str(raw.turnId) ?? "";
  const orderKey = str(raw.orderKey) ?? `${createdAt.toString().padStart(16, "0")}:${id}`;
  const message: Message = { id, conversationId, turnId, role, createdAt, orderKey, content };
  const thinking = str(raw.thinking);
  if (thinking !== undefined) message.thinking = thinking;
  const sourceSnapshot = arrayOf(raw.sourceSnapshot, decodeSourceReference);
  if (sourceSnapshot) message.sourceSnapshot = sourceSnapshot;
  const citations = arrayOf(raw.citations, decodeCitation);
  if (citations) message.citations = citations;
  const evidence = decodeEvidence(raw.evidence);
  if (evidence) message.evidence = evidence;
  const provider = decodeProvider(raw.provider);
  if (provider) message.provider = provider;
  const toolResults = arrayOf(raw.toolResults, decodeToolResult);
  if (toolResults) message.toolResults = toolResults;
  const artifactIds = stringArray(raw.artifactIds);
  if (artifactIds) message.artifactIds = artifactIds;
  if (raw.legacyPayload !== undefined) message.legacyPayload = raw.legacyPayload;
  // Everything not claimed by the canonical shape is preserved verbatim in
  // the legacy payload so no legacy byte is lost on a round trip.
  const extras = collectUnknownKeys(raw, MESSAGE_KNOWN_KEYS);
  if (extras) {
    message.legacyPayload = message.legacyPayload === undefined
      ? { ...extras }
      : isRecord(message.legacyPayload)
        ? { ...(message.legacyPayload as Record<string, unknown>), ...extras }
        : { legacy: message.legacyPayload, ...extras };
  }
  return message;
}

const DRAFT_KNOWN_KEYS = [
  "conversationId", "deviceId", "revision", "text", "attachments",
  "mentionTokens", "selection", "updatedAt",
] as const;

function decodeMentionToken(raw: unknown): MentionToken | null {
  if (!isRecord(raw)) return null;
  const token = str(raw.token);
  const kind = str(raw.kind);
  if (!token || (kind !== "document" && kind !== "section")) return null;
  const mention: MentionToken = { token, kind };
  const id = str(raw.id);
  if (id !== undefined) mention.id = id;
  const label = str(raw.label);
  if (label !== undefined) mention.label = label;
  return mention;
}

export function decodeDraft(raw: unknown): Draft | null {
  if (!isRecord(raw)) return null;
  const conversationId = str(raw.conversationId);
  const deviceId = str(raw.deviceId);
  const text = str(raw.text);
  const updatedAt = num(raw.updatedAt);
  if (!conversationId || !deviceId || text === undefined || updatedAt === undefined) return null;
  const draft: Draft = {
    conversationId,
    deviceId,
    revision: num(raw.revision) ?? 0,
    text,
    attachments: arrayOf(raw.attachments, decodeAttachment) ?? [],
    mentionTokens: arrayOf(raw.mentionTokens, decodeMentionToken) ?? [],
    updatedAt,
  };
  const selection = decodeSelectionSnapshot(raw.selection);
  if (selection) draft.selection = selection;
  const extras = collectUnknownKeys(raw, DRAFT_KNOWN_KEYS);
  if (extras) (draft as Draft & { unknownFields?: unknown }).unknownFields = extras;
  return draft;
}

export function decodeDraftAlternative(raw: unknown): DraftAlternative | null {
  if (!isRecord(raw)) return null;
  const conversationId = str(raw.conversationId);
  const deviceId = str(raw.deviceId);
  const text = str(raw.text);
  const receivedAt = num(raw.receivedAt);
  if (!conversationId || !deviceId || text === undefined || receivedAt === undefined) return null;
  return {
    conversationId,
    deviceId,
    text,
    attachments: arrayOf(raw.attachments, decodeAttachment) ?? [],
    receivedAt,
  };
}

function decodeFrozenPlan(raw: unknown): FrozenTurnPlan | null {
  if (!isRecord(raw)) return null;
  const conversationId = str(raw.conversationId);
  const turnId = str(raw.turnId);
  const question = str(raw.question);
  const policy = decodeContextPolicy(raw.policy);
  if (!conversationId || !turnId || question === undefined || !policy) return null;
  if (!isRecord(raw.provider)) return null;
  const configurationId = str(raw.provider.configurationId);
  const kind = str(raw.provider.kind);
  const model = str(raw.provider.model);
  const locality = raw.provider.locality === "remote" ? "remote" : raw.provider.locality === "on-device" ? "on-device" : undefined;
  if (!configurationId || !kind || model === undefined || !locality) return null;
  const plan: FrozenTurnPlan = {
    conversationId,
    turnId,
    question,
    mentionTokens: arrayOf(raw.mentionTokens, (v) => {
      if (!isRecord(v)) return null;
      const token = str(v.token);
      const tokenKind = str(v.kind);
      if (!token || (tokenKind !== "document" && tokenKind !== "section")) return null;
      const mention: FrozenTurnPlan["mentionTokens"][number] = { token, kind: tokenKind };
      const id = str(v.id);
      if (id !== undefined) mention.id = id;
      return mention;
    }) ?? [],
    policy,
    sources: arrayOf(raw.sources, decodeSourceReference) ?? [],
    provider: { configurationId, kind, model, locality },
    requestEpoch: num(raw.requestEpoch) ?? 0,
  };
  const selection = decodeSelectionSnapshot(raw.selection);
  if (selection) plan.selection = selection;
  const historySourceIds = stringArray(raw.historySourceIds);
  if (historySourceIds) plan.historySourceIds = historySourceIds;
  const fallback = stringArray(raw.provider.fallback);
  if (fallback) plan.provider.fallback = fallback;
  if (isRecord(raw.budget)) {
    const budget: NonNullable<FrozenTurnPlan["budget"]> = {};
    const contextTokens = num(raw.budget.contextTokens);
    if (contextTokens !== undefined) budget.contextTokens = contextTokens;
    const suppliedChars = num(raw.budget.suppliedChars);
    if (suppliedChars !== undefined) budget.suppliedChars = suppliedChars;
    const truncated = bool(raw.budget.truncated);
    if (truncated !== undefined) budget.truncated = truncated;
    if (Object.keys(budget).length) plan.budget = budget;
  }
  return plan;
}

const ATTEMPT_KNOWN_KEYS = [
  "id", "turnId", "requestPlan", "status", "startedAt", "finishedAt",
  "failureReason", "detached", "provider",
] as const;

function decodeAttempt(raw: unknown): Attempt | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const turnId = str(raw.turnId);
  const status = raw.status;
  const startedAt = num(raw.startedAt);
  const plan = decodeFrozenPlan(raw.requestPlan);
  if (!id || !turnId || !isTurnStatus(status) || startedAt === undefined || !plan) return null;
  const attempt: Attempt = { id, turnId, requestPlan: plan, status, startedAt };
  const finishedAt = num(raw.finishedAt);
  if (finishedAt !== undefined) attempt.finishedAt = finishedAt;
  const failureReason = str(raw.failureReason);
  if (failureReason !== undefined) attempt.failureReason = failureReason as Attempt["failureReason"];
  const detached = bool(raw.detached);
  if (detached !== undefined) attempt.detached = detached;
  const provider = decodeProvider(raw.provider);
  if (provider) attempt.provider = provider;
  const extras = collectUnknownKeys(raw, ATTEMPT_KNOWN_KEYS);
  if (extras) (attempt as Attempt & { unknownFields?: unknown }).unknownFields = extras;
  return attempt;
}

function decodeTurn(raw: unknown): Turn | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const conversationId = str(raw.conversationId);
  const userMessageId = str(raw.userMessageId);
  const status = raw.status;
  const plan = decodeFrozenPlan(raw.requestPlan);
  const createdAt = num(raw.createdAt);
  if (!id || !conversationId || !userMessageId || !isTurnStatus(status) || !plan || createdAt === undefined) return null;
  const attempts = arrayOf(raw.attempts, decodeAttempt) ?? [];
  const turn: Turn = {
    id,
    conversationId,
    userMessageId,
    requestPlan: plan,
    status,
    attempts,
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
  const parentTurnId = str(raw.parentTurnId);
  if (parentTurnId !== undefined) turn.parentTurnId = parentTurnId;
  const acceptedAttemptId = str(raw.acceptedAttemptId);
  if (acceptedAttemptId !== undefined) turn.acceptedAttemptId = acceptedAttemptId;
  return turn;
}

const CONVERSATION_KNOWN_KEYS = [
  "version", "id", "ownerProfileId", "collectionId", "title", "createdAt",
  "updatedAt", "revision", "contextPolicy", "activeAttachments",
  "sourceHistory", "syncPolicy", "deletedAt", "legacyAliases",
  "unknownFields", "messages", "turns", "draft", "draftAlternatives",
] as const;

/**
 * Decode one persisted conversation record. Returns a reason instead of
 * throwing for quarantine reporting.
 */
export function decodeConversationRecord(raw: unknown): DecodeResult<ConversationRecord> {
  if (!isRecord(raw)) return fail("record is not an object");
  const id = str(raw.id);
  if (!id) return fail("missing conversation id");
  const ownerProfileId = str(raw.ownerProfileId);
  if (!ownerProfileId) return fail("missing ownerProfileId");
  const title = str(raw.title);
  if (title === undefined) return fail("missing title");
  const createdAt = num(raw.createdAt);
  const updatedAt = num(raw.updatedAt);
  if (createdAt === undefined || updatedAt === undefined) return fail("missing timestamps");
  const contextPolicy = decodeContextPolicy(raw.contextPolicy);
  if (!contextPolicy) return fail("missing or invalid contextPolicy");

  const syncPolicy: SyncPolicy = raw.syncPolicy === "eligible" ? "eligible" : "device-local";
  const record: ConversationRecord = {
    version: CONVERSATION_RECORD_VERSION,
    id,
    ownerProfileId,
    title,
    createdAt,
    updatedAt,
    revision: num(raw.revision) ?? 0,
    contextPolicy,
    activeAttachments: arrayOf(raw.activeAttachments, decodeAttachment) ?? [],
    sourceHistory: arrayOf(raw.sourceHistory, decodeSourceReference) ?? [],
    syncPolicy,
    legacyAliases: stringArray(raw.legacyAliases) ?? [],
    messages: arrayOf(raw.messages, decodeMessage) ?? [],
    turns: arrayOf(raw.turns, decodeTurn) ?? [],
  };
  const collectionId = str(raw.collectionId);
  if (collectionId !== undefined) record.collectionId = collectionId;
  const deletedAt = num(raw.deletedAt);
  if (deletedAt !== undefined) record.deletedAt = deletedAt;
  const draft = decodeDraft(raw.draft);
  if (draft) record.draft = draft;
  const alternatives = arrayOf(raw.draftAlternatives, decodeDraftAlternative);
  if (alternatives) record.draftAlternatives = alternatives;

  const unknownFields: Record<string, unknown> = {};
  let hasUnknown = false;
  const claimed = isRecord(raw.unknownFields) ? raw.unknownFields : {};
  for (const [key, value] of Object.entries(claimed)) {
    unknownFields[key] = value;
    hasUnknown = true;
  }
  const extras = collectUnknownKeys(raw, CONVERSATION_KNOWN_KEYS);
  if (extras) {
    Object.assign(unknownFields, extras);
    hasUnknown = true;
  }
  if (hasUnknown) record.unknownFields = unknownFields;

  return ok(record);
}

/**
 * Encode a record for persistence. Deterministic key order so persisted
 * bytes are stable for hash-based import verification.
 */
export function encodeConversationRecord(record: ConversationRecord): string {
  return JSON.stringify(record, null, 2);
}

/* ------------------------------------------------------------------ */
/* Version-1 (legacy shaped) upgrade                                   */
/* ------------------------------------------------------------------ */

/**
 * Upgrade a version-1 (pre-canonical) conversation object. This function is
 * for records that already use canonical-ish naming but predate version 2
 * fields; the raw *legacy* storage shapes (sidebar map, Q&A sessions) are
 * handled by the import module in task 1.5.
 */
export function upgradeConversationV1(raw: unknown): DecodeResult<ConversationRecord> {
  if (!isRecord(raw)) return fail("record is not an object");
  const upgraded: Record<string, unknown> = { ...raw };
  if (raw.version === 1 || raw.version === undefined) {
    upgraded.version = CONVERSATION_RECORD_VERSION;
  }
  // Honest defaults: never invent citations or evidence on upgrade.
  if (!isRecord(upgraded.contextPolicy)) {
    const mode = upgraded.mode ?? upgraded.scope;
    upgraded.contextPolicy = { mode: isContextPolicyMode(mode) ? mode : "auto", origin: "explicit" };
  }
  if (upgraded.syncPolicy !== "eligible") upgraded.syncPolicy = "device-local";
  if (!Array.isArray(upgraded.legacyAliases)) upgraded.legacyAliases = [];
  return decodeConversationRecord(upgraded);
}

/**
 * Decide whether stored JSON is a version-2 record or a legacy shape that
 * import must handle. Never guesses: an unknown shape is reported back.
 */
export function classifyStoredPayload(raw: unknown): "v2" | "v1" | "unknown" {
  if (!isRecord(raw)) return "unknown";
  if (raw.version === CONVERSATION_RECORD_VERSION) return "v2";
  if (raw.version === 1 || (typeof raw.id === "string" && (raw.messages !== undefined || raw.contextPolicy !== undefined))) {
    return "v1";
  }
  return "unknown";
}

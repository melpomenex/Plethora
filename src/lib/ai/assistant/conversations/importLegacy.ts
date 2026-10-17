/**
 * Raw legacy import (design D2/migration plan, tasks 1.5/1.6).
 *
 * Imports the *raw* legacy storage shapes without calling the capped UI
 * loaders (`loadSessions`, `readStoredConversations`, `createSession`):
 * those apply 50×50/200 retention caps and normalize away unknown fields.
 * Import rules here:
 *
 *  - Deterministic IDs: `profile + origin + original legacy key/id`, so
 *    repeated or crash-resumed imports converge on the same conversation.
 *  - Message IDs keep their original values inside their origin namespace
 *    (two origins may legitimately reuse an id).
 *  - Original timestamps are preserved; the source fingerprint is recorded in
 *    `legacyAliases` so a re-import of a newer revision is possible.
 *  - Unknown fields survive in `unknownFields` / message `legacyPayload`.
 *  - Malformed records are journaled as `quarantined` with their raw bytes;
 *    they are never reported as imported.
 *  - Existing capped legacy *originals* are untouched: this module only
 *    reads them.
 */

import type { ConversationRepository, ImportCheckpoint, QuarantinedRecord } from "./repository";
import { decodeConversationRecord } from "./serialize";
import type {
  ConversationRecord,
  Message,
  MentionToken,
  SourceAttachment,
  SourceReference,
} from "./types";

/* ------------------------------------------------------------------ */
/* Input shapes (raw, as stored by legacy surfaces)                     */
/* ------------------------------------------------------------------ */

export interface LegacyMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  thinking?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
}

/** One raw legacy record with its origin identity. */
export interface LegacyImportRecord {
  origin: string;
  /** Original key/id inside that origin (never rewritten). */
  recordKey: string;
  /** Raw parsed JSON record. */
  raw: unknown;
  /** Full raw text for digests and quarantine; defaults to JSON of `raw`. */
  rawText?: string;
  /** Where this record's revision came from (for reporting). */
  revisionHint?: string;
}

export interface LegacyImportSource {
  /** Snapshot of the legacy storage as recorded before the cutover. */
  records: LegacyImportRecord[];
}

export interface ImportedRecordOutcome {
  origin: string;
  recordKey: string;
  status: "imported" | "quarantined" | "skipped";
  conversationId?: string;
  reason?: string;
  messageCount?: number;
}

export interface LegacyImportReport {
  outcomes: ImportedRecordOutcome[];
  importedConversations: number;
  importedMessages: number;
  quarantined: number;
  skipped: number;
  /** True when every record in the snapshot reached a final state. */
  complete: boolean;
  checkpoint: ImportCheckpoint;
}

/* ------------------------------------------------------------------ */
/* Deterministic identity                                               */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit; deterministic across platforms and stable over time. */
export function stableDigest(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic conversation ID for a legacy record. The same
 * (profile, origin, key) always maps to the same ID, so an interrupted import
 * that re-runs does not duplicate threads. Distinct legacy keys stay distinct
 * threads even when their text matches (spec: "distinct keys are distinct").
 */
export function legacyConversationId(
  ownerProfileId: string,
  origin: string,
  recordKey: string,
): string {
  return `legacy-${stableDigest(`${ownerProfileId}\u0000${origin}\u0000${recordKey}`)}-${stableDigest(recordKey)}`;
}

/* ------------------------------------------------------------------ */
/* Decoders for each legacy shape                                       */
/* ------------------------------------------------------------------ */

function tsMillis(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Already milliseconds; seconds are normalized (legacy SQLite stores ISO
    // strings, handled by the caller).
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MESSAGE_KNOWN_KEYS = new Set([
  "id", "role", "content", "thinking", "timestamp", "createdAt", "orderKey",
  "toolCalls", "sourceContext", "images", "citations", "sourceDocuments",
  "mentionedDocumentIds", "submittedScope", "evidence",
]);

function decodeLegacyMessage(
  raw: unknown,
  conversationId: string,
  turnId: string,
  index: number,
  fallbackTimestamp: number,
): Message | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : `${conversationId}-m${index}`;
  const role =
    raw.role === "user" || raw.role === "assistant" || raw.role === "system"
      ? raw.role
      : null;
  const content = typeof raw.content === "string" ? raw.content : null;
  if (!role || content === null) return null;
  const createdAt = tsMillis(raw.createdAt ?? raw.timestamp, fallbackTimestamp + index);
  // Unknown legacy bytes (tool calls, images, old citation arrays, evidence
  // blocks, everything unrecognized) survive verbatim in the payload; they are
  // never interpreted as canonical evidence. Legacy `[N]` text stays readable
  // and unverified.
  const legacyPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "id" || key === "role" || key === "content" || key === "createdAt") continue;
    if (key === "timestamp") {
      legacyPayload.originalTimestamp = value;
      continue;
    }
    legacyPayload[key] = value;
  }
  const message: Message = {
    id,
    conversationId,
    turnId,
    role,
    createdAt,
    orderKey: `${createdAt.toString().padStart(16, "0")}:${id}`,
    content,
  };
  if (typeof raw.thinking === "string") message.thinking = raw.thinking;
  if (Object.keys(legacyPayload).length) message.legacyPayload = legacyPayload;
  void MESSAGE_KNOWN_KEYS;
  return message;
}

interface DecodedLegacyThread {
  messages: Message[];
  title: string;
  createdAt: number;
  updatedAt: number;
  scopeHint?: "chat" | "document" | "library";
  selectedDocumentId?: string;
  draft?: {
    text: string;
    mentionTokens: MentionToken[];
    selection?: { originalText: string; documentId?: string };
  };
  activeAttachments: SourceAttachment[];
  unknownFields?: Record<string, unknown>;
}

function decodeSidebarConversation(
  conversationId: string,
  raw: unknown,
): DecodedLegacyThread | { error: string } {
  if (!isRecord(raw)) return { error: "sidebar record is not an object" };
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : null;
  if (!rawMessages) return { error: "sidebar record has no messages array" };
  const messages: Message[] = [];
  rawMessages.forEach((value, index) => {
    const decoded = decodeLegacyMessage(value, conversationId, "", index, 0);
    if (decoded) messages.push(decoded);
  });
  // Sidebar conversation keys are context-derived; the import caller passes
  // the key so the scope hint can be derived there.
  const lastTimestamp = messages.length ? messages[messages.length - 1].createdAt : 0;
  const title = messages.find((message) => message.role === "user")?.content ?? "";
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === "messages" || key === "input" || key === "updatedAt" || key === "scope") continue;
    extras[key] = raw[key];
  }
  return {
    messages,
    title: title.slice(0, 60) || "Imported conversation",
    createdAt: messages[0]?.createdAt ?? 0,
    updatedAt: tsMillis(raw.updatedAt, lastTimestamp),
    scopeHint:
      raw.scope === "document" ? "document" : raw.scope === "library" ? "library" : "chat",
    draft:
      typeof raw.input === "string" && raw.input
        ? { text: raw.input, mentionTokens: [] }
        : undefined,
    activeAttachments: [],
    unknownFields: Object.keys(extras).length ? extras : undefined,
  };
}

function decodeQaSession(
  conversationId: string,
  raw: unknown,
): DecodedLegacyThread | { error: string } {
  if (!isRecord(raw)) return { error: "session is not an object" };
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : null;
  if (!rawMessages) return { error: "session has no messages array" };
  const messages: Message[] = [];
  rawMessages.forEach((value, index) => {
    const decoded = decodeLegacyMessage(value, conversationId, "", index, 0);
    if (decoded) messages.push(decoded);
  });
  const draftRaw = isRecord(raw.draft) ? raw.draft : null;
  const sections = draftRaw && Array.isArray(draftRaw.sections) ? draftRaw.sections : [];
  const mentionTokens: MentionToken[] = sections.flatMap((section) => {
    if (!isRecord(section) || typeof section.id !== "string") return [];
    return [{
      token: `@${typeof section.title === "string" ? section.title : section.id}`,
      kind: "section" as const,
      id: section.id,
      label: typeof section.title === "string" ? section.title : undefined,
    }];
  });
  const draft = draftRaw
    ? {
        text: typeof draftRaw.text === "string" ? draftRaw.text : "",
        mentionTokens,
        selection:
          typeof draftRaw.contextPassage === "string" && draftRaw.contextPassage
            ? {
                originalText: draftRaw.contextPassage,
                documentId:
                  typeof raw.selectedDocumentId === "string" && raw.selectedDocumentId
                    ? raw.selectedDocumentId
                    : undefined,
              }
            : undefined,
      }
    : undefined;
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (
      key === "id" || key === "title" || key === "createdAt" || key === "updatedAt" ||
      key === "messages" || key === "draft" || key === "scope" ||
      key === "selectedDocumentId" || key === "webSearchEnabled" ||
      key === "messageCount" || key === "documentName"
    ) {
      continue;
    }
    extras[key] = raw[key];
  }
  const selectedDocumentId =
    typeof raw.selectedDocumentId === "string" && raw.selectedDocumentId
      ? raw.selectedDocumentId
      : undefined;
  const attachments: SourceAttachment[] = selectedDocumentId
    ? [{
        attachmentId: `legacy-doc-${stableDigest(selectedDocumentId)}`,
        kind: "document",
        libraryId: selectedDocumentId,
        title:
          typeof raw.documentName === "string" && raw.documentName
            ? raw.documentName
            : selectedDocumentId,
        origin: "history",
        role: "optional",
        active: false,
      }]
    : [];
  return {
    messages,
    title:
      typeof raw.title === "string" && raw.title && raw.title !== "New chat"
        ? raw.title
        : messages.find((message) => message.role === "user")?.content.slice(0, 60) ??
          "Imported conversation",
    createdAt: tsMillis(raw.createdAt, messages[0]?.createdAt ?? 0),
    updatedAt: tsMillis(raw.updatedAt, messages[messages.length - 1]?.createdAt ?? 0),
    scopeHint:
      raw.scope === "chat" || raw.scope === "document" || raw.scope === "library"
        ? raw.scope
        : selectedDocumentId
          ? "document"
          : "library",
    selectedDocumentId,
    draft,
    activeAttachments: attachments,
    unknownFields: Object.keys(extras).length ? extras : undefined,
  };
}

/**
 * The import entry point. `snapshot` should be read from raw storage, not from
 * the capped UI loaders. The repository's own digest journal makes this
 * idempotent; the returned checkpoint can resume after a crash.
 */
export async function importLegacyRecords(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
  snapshot: LegacyImportSource;
  /** Optional resume position by outcome index. */
  checkpoint?: ImportCheckpoint;
  /** Test seam for storage layering decisions. */
  onQuarantine?: (record: QuarantinedRecord) => void;
}): Promise<LegacyImportReport> {
  const { repository, ownerProfileId, snapshot } = options;
  const outcomes: ImportedRecordOutcome[] = [];
  let importedConversations = options.checkpoint?.importedConversations ?? 0;
  let importedMessages = options.checkpoint?.importedMessages ?? 0;
  let quarantined = options.checkpoint?.quarantined ?? 0;
  const start = options.checkpoint?.cursor ? Number(options.checkpoint.cursor) : 0;

  for (let index = start; index < snapshot.records.length; index++) {
    const record = snapshot.records[index];
    const rawText = record.rawText ?? safeStringify(record.raw);
    const digest = stableDigest(`${record.origin}\u0000${record.recordKey}\u0000${rawText}`);
    const conversationId = legacyConversationId(ownerProfileId, record.origin, record.recordKey);
    const isSidebar = record.origin.startsWith("sidebar");
    const decoded = isSidebar
      ? decodeSidebarConversation(conversationId, record.raw)
      : decodeQaSession(conversationId, record.raw);

    if ("error" in decoded) {
      // Malformed record: quarantine with its raw bytes, never import.
      quarantined += 1;
      const quarantine: QuarantinedRecord = {
        origin: record.origin,
        digest,
        reason: decoded.error,
        raw: record.raw,
      };
      options.onQuarantine?.(quarantine);
      outcomes.push({
        origin: record.origin,
        recordKey: record.recordKey,
        status: "quarantined",
        reason: decoded.error,
      });
      // Route the raw bytes through the repository import so the quarantine
      // store keeps them recoverable (never `imported`).
      await repository.importConversations(
        ownerProfileId,
        { formatVersion: 1, exportedAt: Date.now(), conversations: [record.raw as never] },
      );
      continue;
    }

    const thread = decoded;
    const existing = await repository.getConversation(ownerProfileId, conversationId);
    if (existing.ok && existing.value?.legacyAliases.includes(digest)) {
      // Same revision already imported: idempotent no-op.
      outcomes.push({
        origin: record.origin,
        recordKey: record.recordKey,
        status: "skipped",
        conversationId,
        reason: "already imported at this revision",
      });
      continue;
    }

    const now = Date.now();
    const conversation: ConversationRecord = {
      version: 2,
      id: conversationId,
      ownerProfileId,
      title: thread.title,
      createdAt: thread.createdAt || now,
      updatedAt: thread.updatedAt || now,
      revision: existing.ok && existing.value ? existing.value.revision : 0,
      contextPolicy: {
        mode: thread.scopeHint === "library" ? "library" : thread.scopeHint === "document" ? "document" : "chat",
        origin: "explicit",
      },
      activeAttachments: thread.activeAttachments,
      sourceHistory: thread.activeAttachments.map(
        ({ active: _active, ...reference }) => reference as SourceReference,
      ),
      syncPolicy: "device-local",
      legacyAliases: [digest, `${record.origin}:${record.recordKey}`],
      unknownFields: thread.unknownFields,
      messages: thread.messages,
      turns: [],
      draft: thread.draft?.text
        ? {
            conversationId,
            deviceId: "legacy-import",
            revision: 0,
            text: thread.draft.text,
            attachments: thread.activeAttachments,
            mentionTokens: thread.draft.mentionTokens,
            selection: thread.draft.selection,
            updatedAt: thread.updatedAt || now,
          }
        : undefined,
    };

    const decodedCanonical = decodeConversationRecord(conversation);
    if (!decodedCanonical.ok) {
      quarantined += 1;
      outcomes.push({
        origin: record.origin,
        recordKey: record.recordKey,
        status: "quarantined",
        reason: decodedCanonical.reason ?? "canonical validation failed",
      });
      continue;
    }

    // Import through the clone path: merge by id so repeated imports converge
    // and a newer legacy revision replaces the imported message set without
    // duplicating identities.
    const bundle = {
      formatVersion: 1 as const,
      exportedAt: now,
      conversations: [conversation],
    };
    const imported = await repository.importConversations(ownerProfileId, bundle);
    if (!imported.ok) {
      outcomes.push({
        origin: record.origin,
        recordKey: record.recordKey,
        status: "quarantined",
        reason: imported.error?.message ?? "import failed",
      });
      quarantined += 1;
      continue;
    }
    importedConversations += 1;
    importedMessages += thread.messages.length;
    outcomes.push({
      origin: record.origin,
      recordKey: record.recordKey,
      status: "imported",
      conversationId,
      messageCount: thread.messages.length,
    });
  }

  return {
    outcomes,
    importedConversations,
    importedMessages,
    quarantined,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    complete: true,
    checkpoint: {
      cursor: String(snapshot.records.length),
      importedConversations,
      importedMessages,
      quarantined,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Raw storage capture helpers (no capped UI loaders)                  */
/* ------------------------------------------------------------------ */

/**
 * Parse the sidebar's raw `assistant-panel-conversations-v1` value into import
 * records. Keeps every key, including ones the UI cap would drop.
 */
export function sidebarRecordsFromRaw(rawJson: string | null): LegacyImportRecord[] {
  if (!rawJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [{
      origin: "sidebar",
      recordKey: "__unreadable__",
      raw: rawJson,
      rawText: rawJson,
    }];
  }
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed).map(([key, value]) => ({
    origin: `sidebar:${key.split(":")[0] || "general"}`,
    recordKey: key,
    raw: value,
    rawText: safeStringify(value),
  }));
}

/** Parse the Q&A raw sessions array without `loadSessions`' caps. */
export function qaSessionRecordsFromRaw(rawJson: string | null): LegacyImportRecord[] {
  if (!rawJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [{
      origin: "qa-sessions",
      recordKey: "__unreadable__",
      raw: rawJson,
      rawText: rawJson,
    }];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((value, index) => {
    const key = isRecord(value) && typeof value.id === "string" && value.id ? value.id : `index-${index}`;
    return {
      origin: "qa-sessions",
      recordKey: key,
      raw: value,
      rawText: safeStringify(value),
    };
  });
}

/**
 * Parse the legacy Zustand `plethora-document-qa` blob. Modern installs carry
 * `{ state: {}, version }` after the partialize change; older installs still
 * hold the last pre-session-store message list. Only the latter has content to
 * import; an empty modern blob is skipped without pretending data was
 * recovered (spec: never claim recovery of already-discarded state).
 */
export function legacyZustandRecordsFromRaw(rawJson: string | null): LegacyImportRecord[] {
  if (!rawJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [{
      origin: "legacy-zustand",
      recordKey: "__unreadable__",
      raw: rawJson,
      rawText: rawJson,
    }];
  }
  const messages =
    isRecord(parsed) && isRecord(parsed.state)
      ? (parsed.state as Record<string, unknown>).messages
      : isRecord(parsed)
        ? parsed.messages
        : undefined;
  if (!Array.isArray(messages) || messages.length === 0) return [];
  return [{
    origin: "legacy-zustand",
    recordKey: "plethora-document-qa",
    raw: { messages },
    rawText: safeStringify({ messages }),
  }];
}

/** Parse raw `ai_conversations`/`ai_messages` rows (native import). */
export function sqliteRecordsFromRows(rows: {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}): LegacyImportRecord[] {
  const byConversation = new Map<string, Array<Record<string, unknown>>>();
  for (const message of rows.messages) {
    const conversationId = typeof message.conversation_id === "string" ? message.conversation_id : "";
    const list = byConversation.get(conversationId) ?? [];
    list.push(message);
    byConversation.set(conversationId, list);
  }
  return rows.conversations.map((conversation) => {
    const id = typeof conversation.id === "string" ? conversation.id : "unknown";
    const messages = (byConversation.get(id) ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      tokens_used: message.tokens_used,
    }));
    const raw = {
      id,
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      documentId: conversation.document_id,
      dateCreated: conversation.date_created,
      dateModified: conversation.date_modified,
      messages,
    };
    return {
      origin: "sqlite",
      recordKey: id,
      raw,
      rawText: safeStringify(raw),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Live ephemeral snapshots (task 1.6)                                 */
/* ------------------------------------------------------------------ */

/** A live snapshot captured from an ephemeral surface before unmount. */
export interface LiveSnapshotInput {
  surface: "ask-sheet" | "pwa-assistant";
  /** Captured before the surface unmounts; only what is still alive. */
  question?: string;
  answer?: string;
  selectionText?: string;
  documentId?: string;
  title?: string;
  /** Original timestamps; preserved rather than replaced with import time. */
  capturedAt?: number;
}

export interface LiveSnapshotDraft {
  conversationId: string;
  ownerProfileId: string;
  title: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
  }>;
  selection?: { originalText: string; documentId?: string };
  /** Live surfaces are device-local; their threads never enter sync */
  deviceLocal: true;
}

/**
 * Build the canonical draft for a live ephemeral snapshot. This never claims
 * to recover previously discarded state: callers must pass only state that is
 * still alive at capture time.
 */
export function buildLiveSnapshotDraft(
  ownerProfileId: string,
  input: LiveSnapshotInput,
): LiveSnapshotDraft {
  const conversationId = `live-${stableDigest(
    `${ownerProfileId}\u0000${input.surface}\u0000${input.documentId ?? ""}\u0000${input.capturedAt ?? ""}\u0000${input.selectionText ?? ""}`,
  )}`;
  const capturedAt = input.capturedAt ?? Date.now();
  const messages: LiveSnapshotDraft["messages"] = [];
  if (input.question) {
    messages.push({
      id: `${conversationId}-u0`,
      role: "user",
      content: input.question,
      createdAt: capturedAt,
    });
  }
  if (input.answer) {
    messages.push({
      id: `${conversationId}-a0`,
      role: "assistant",
      content: input.answer,
      createdAt: capturedAt + 1,
    });
  }
  return {
    conversationId,
    ownerProfileId,
    title:
      input.title ??
      input.question?.slice(0, 60) ??
      (input.surface === "ask-sheet" ? "Selection question" : "Reader question"),
    messages,
    selection: input.selectionText
      ? { originalText: input.selectionText, documentId: input.documentId }
      : undefined,
    deviceLocal: true,
  };
}

/**
 * Persist a live ephemeral snapshot. The resulting conversation is
 * device-local, has no provider provenance (the answer text is remembered,
 * not re-derived) and never claims verified evidence.
 */
export async function importLiveSnapshot(options: {
  repository: ConversationRepository;
  draft: LiveSnapshotDraft;
}): Promise<{ ok: boolean; conversationId: string; reason?: string }> {
  const { repository, draft } = options;
  const existing = await repository.getConversation(draft.ownerProfileId, draft.conversationId);
  if (existing.ok && existing.value) {
    return { ok: true, conversationId: draft.conversationId, reason: "already captured" };
  }
  const now = Date.now();
  const record: ConversationRecord = {
    version: 2,
    id: draft.conversationId,
    ownerProfileId: draft.ownerProfileId,
    title: draft.title,
    createdAt: draft.messages[0]?.createdAt ?? now,
    updatedAt: draft.messages[draft.messages.length - 1]?.createdAt ?? now,
    revision: 0,
    contextPolicy: {
      mode: draft.selection ? "document" : "chat",
      origin: "entry",
    },
    activeAttachments: draft.selection?.documentId
      ? [{
          attachmentId: `live-doc-${stableDigest(draft.selection.documentId)}`,
          kind: "document",
          libraryId: draft.selection.documentId,
          title: draft.selection.documentId,
          origin: "selection",
          role: "optional",
          active: false,
        }]
      : [],
    sourceHistory: [],
    syncPolicy: "device-local",
    legacyAliases: [`live:${draft.conversationId}`],
    messages: draft.messages.map((message) => ({
      id: message.id,
      conversationId: draft.conversationId,
      turnId: "",
      role: message.role,
      createdAt: message.createdAt,
      orderKey: `${message.createdAt.toString().padStart(16, "0")}:${message.id}`,
      content: message.content,
      // Remembered answer text is not re-derived evidence.
      evidence: rememberedAnswerEvidence(message.role),
    })),
    turns: [],
  };
  const bundle = {
    formatVersion: 1 as const,
    exportedAt: now,
    conversations: [record],
  };
  const imported = await repository.importConversations(draft.ownerProfileId, bundle);
  if (!imported.ok) {
    return {
      ok: false,
      conversationId: draft.conversationId,
      reason: imported.error?.message ?? "capture failed",
    };
  }
  return { ok: true, conversationId: draft.conversationId };
}

function rememberedAnswerEvidence(role: "user" | "assistant"): Message["evidence"] | undefined {
  if (role !== "assistant") return undefined;
  return {
    origin: "mixed",
    level: "unverified",
    retrievalMode: "none",
    sourceFree: false,
  };
}

/**
 * Export recoverable quarantine/legacy data for a user-visible recovery path.
 * Never rewrites or normalizes the bytes.
 */
export async function exportRecoverableData(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
}): Promise<{ quarantined: QuarantinedRecord[]; conversations: ConversationRecord[] }> {
  const quarantined = await options.repository.listQuarantined(options.ownerProfileId);
  const exported = await options.repository.exportConversations(options.ownerProfileId, {
    includeDeleted: true,
  });
  return {
    quarantined: quarantined.ok ? quarantined.value ?? [] : [],
    conversations: exported.ok ? exported.value?.conversations ?? [] : [],
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

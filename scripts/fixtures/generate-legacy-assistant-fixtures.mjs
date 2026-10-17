#!/usr/bin/env node
/**
 * Generate the raw legacy Assistant-storage fixture corpus (task 0.4 of the
 * unify-assistant-experience change).
 *
 * The corpus is a *local capture*: it is written next to the change directory
 * under `fixtures/` and intentionally git-ignored (see
 * `openspec/changes/unify-assistant-experience/.gitignore`). Only this
 * generator and the resulting manifest are committed, so the corpus is
 * reproducible byte-for-byte from the seed below on any machine.
 *
 * Shapes are taken from the real readers at the audited HEAD:
 *   - sidebar      `AssistantPanel.tsx` `StoredConversationMap` under
 *                  `assistant-panel-conversations-v1` (200-message cap)
 *   - Q&A sessions `documentQaSessions.ts` `DocumentQaSession[]` under
 *                  `document-qa-sessions-v1` (50 sessions x 50 messages cap)
 *   - legacy store `documentQAStore.ts` zustand persist blob under
 *                  `plethora-document-qa` (`{ state: {}, version }` after the
 *                  partialize change; older installs still hold messages)
 *   - SQLite       `ai_conversations` / `ai_messages` rows from migration 003
 *
 * The corpus deliberately includes: more records than either legacy cap,
 * duplicate original IDs across origins, unknown/extra fields, drafts with
 * sections and context passages, inline image attachments, legacy `[N]`
 * citation footers, tool-call artifacts, malformed records (typed
 * wrong / truncated JSON), and one oversized session whose JSON exceeds 1 MB
 * (a quota/stress input, not valid storage).
 *
 * Usage:  node scripts/fixtures/generate-legacy-assistant-fixtures.mjs
 * Output: openspec/changes/unify-assistant-experience/fixtures/
 *           sidebar-conversations.json
 *           qa-sessions.json
 *           legacy-document-qa.json
 *           corrupt-records.json
 *           oversized-session.json
 *           ai-conversations.sql
 *           manifest.json
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEED = 0x5eed_a11a; // fixed; never derive from the clock
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(
  HERE,
  "..",
  "..",
  "openspec", "changes", "unify-assistant-experience", "fixtures",
);
// Bulk capture goes to `data/` (git-ignored); the manifest stays reviewable in
// the parent so the committed diff shows exactly what was captured.
const OUT_DIR = join(FIXTURE_ROOT, "data");
const MANIFEST_PATH = join(FIXTURE_ROOT, "manifest.json");

/** Deterministic PRNG (mulberry32), identical to src/test/bench-support.ts. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seededRandom(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

/** Fixed synthetic clock: 2026-08-01T00:00:00Z. Deterministic timestamps. */
const T0 = 1785456000000;
const FIXED_EPOCH = "2026-08-01T00:00:00.000Z";

const WORDS = [
  "attention", "mechanism", "gradient", "embedding", "retrieval", "compression",
  "chapter", "passage", "citation", "transcript", "synthesis", "hierarchy",
  "token", "budget", "context", "selection", "provenance", "evidence",
];
const questionTemplates = [
  "Explain {a} in the context of {b}",
  "How does {a} relate to {b}?",
  "Summarize the section about {a}",
  "What does the paper say about {a}?",
  "Compare {a} and {b}",
];
const answerTemplates = [
  "The source explains {a} as a process that connects {b} with the surrounding argument.",
  "According to the passage, {a} depends on {b}, and the author illustrates this with a worked example.",
  "This section argues that {a} and {b} are complementary views of the same phenomenon.",
];

const sentence = (template) =>
  template.replace("{a}", pick(WORDS)).replace("{b}", pick(WORDS));

function makeMessage(id, role, index, extra = {}) {
  return {
    id,
    role,
    content: role === "user" ? sentence(pick(questionTemplates)) : sentence(pick(answerTemplates)),
    timestamp: T0 + index * 61_000,
    ...extra,
  };
}

function makeRagHit(docStem, index) {
  return {
    documentId: `doc-${docStem}-${(index % 4) + 1}`,
    documentTitle: `Fixture ${docStem} ${(index % 4) + 1}`,
    chunkIndex: index,
    chunkText: sentence("Verified passage about {a} and {b}."),
    score: Number((0.6 + rand() * 0.3).toFixed(3)),
    // Original prompt ordinal, not the returned-array index (defect A4).
    citationNumber: (index % 4) + 1,
  };
}

const multiDocIds = Array.from({ length: 3000 }, (_, i) => `doc-bulk-${i + 1}`);
const imageDataUrl = (seed) =>
  `data:image/png;base64,${Buffer.from(`fixture-image-${seed}`).toString("base64").repeat(6)}`;

/* ------------------------------------------------------------------ */
/* 1. Sidebar: assistant-panel-conversations-v1                        */
/* ------------------------------------------------------------------ */

function buildConversationEntry(key, messageCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const extras = {};
    if (opts.withCitations && role === "assistant" && i % 4 === 2) {
      extras.citations = [0, 1, 2, 3].map((n) => makeRagHit(opts.stem ?? "side", n));
    }
    if (opts.withTools && role === "assistant" && i % 6 === 3) {
      extras.toolCalls = [{
        name: "create_qa_card",
        parameters: { front: sentence("Define {a}"), back: sentence("A {a} is {b}.") },
        result: { cardId: `card-fixture-${i}` },
        status: "success",
      }];
    }
    if (opts.withThinking && role === "assistant" && i % 5 === 1) {
      extras.thinking = sentence("Considering {a} before answering about {b}.");
    }
    if (opts.withImages && role === "user" && i === 0) {
      extras.images = [{
        id: `img-${key}`,
        name: "fixture-diagram.png",
        type: "image/png",
        size: 204_800,
        dataUrl: imageDataUrl(key),
      }];
    }
    if (opts.unknownFields && i === 1) {
      extras.experimentV2Flag = true;
      extras.unknownNested = { widget: ["legacy", 42, { deep: true }] };
    }
    messages.push(makeMessage(`${key}-m${i}`, role, i, extras));
  }
  const entry = { messages, input: opts.draftInput ?? "", updatedAt: T0 + messageCount * 1000 };
  if (opts.scope) entry.scope = opts.scope;
  if (opts.unknownFields) entry.futureField = { pinned: true };
  return entry;
}

function buildSidebar() {
  const map = {};
  // 60 conversation keys > hypothetical per-key caps; keys cover every context
  // shape the sidebar produces (general/document/video/web/library/section).
  map["general"] = buildConversationEntry("general", 12, { draftInput: "Unsent general draft" });
  map["document:doc-1"] = buildConversationEntry("doc1", 26, {
    scope: "document", withCitations: true, withTools: true, withThinking: true, withImages: true,
  });
  map["document:doc-2"] = buildConversationEntry("doc2", 250, { scope: "document", withCitations: true });
  map["video:vid-1"] = buildConversationEntry("vid1", 18, { scope: "document" });
  map["web:unsaved-article-1"] = buildConversationEntry("web1", 9, { scope: "chat" });
  map["library"] = buildConversationEntry("lib", 33, { scope: "library", withCitations: true });
  for (let i = 0; i < 54; i++) {
    const key = `document:doc-${i + 10}`;
    map[key] = buildConversationEntry(`x${i}`, int(1, 8), {
      scope: i % 3 === 0 ? "document" : i % 3 === 1 ? "library" : undefined,
      unknownFields: i % 7 === 0,
      draftInput: i % 5 === 0 ? sentence("Draft about {a}") : "",
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 2. Q&A sessions: document-qa-sessions-v1                            */
/* ------------------------------------------------------------------ */

function buildQaSession(index, messageCount, opts = {}) {
  const id = opts.id ?? `qa-fixture-${index + 1}`;
  return {
    scope: opts.scope ?? (index % 3 === 0 ? "chat" : index % 3 === 1 ? "document" : "library"),
    id,
    title: opts.title ?? (messageCount > 0 ? sentence(pick(questionTemplates)) : "New chat"),
    createdAt: T0 + index * 86_400_000,
    updatedAt: T0 + index * 86_400_000 + messageCount * 60_000,
    selectedDocumentId: opts.selectedDocumentId ?? (index % 4 === 0 ? "" : `doc-${(index % 6) + 1}`),
    webSearchEnabled: index % 5 === 0,
    messages: Array.from({ length: messageCount }, (_, i) => {
      const role = i % 2 === 0 ? "user" : "assistant";
      const extras = {};
      if (role === "assistant" && opts.withCitations) {
        extras.citations = [makeRagHit("qa", i), makeRagHit("qa", i + 1)];
        extras.evidence = {
          level: "supported", retrievalOnly: false, mode: "semantic", documentCount: 2,
        };
      }
      if (role === "assistant" && opts.withTools && i % 6 === 3) {
        extras.toolCalls = [{
          name: "create_extract",
          parameters: { title: sentence("Extract on {a}") },
          result: { extractId: `extract-fixture-${index}-${i}` },
          status: "success",
        }];
      }
      if (i === 0) extras.mentionedDocumentIds = [`doc-${(index % 6) + 1}`];
      if (opts.unknownFields && i === 0) extras.clientBuildTag = "fixture-build";
      return makeMessage(`${id}-m${i}`, role, i + index * 7, extras);
    }),
    draft: opts.draft ?? {
      text: "",
      sections: [],
    },
    messageCount,
    documentName: opts.documentName ?? (index % 4 === 0 ? "Whole Library" : `Fixture doc ${(index % 6) + 1}`),
    ...(opts.unknownFields ? { migratedFrom: "zustand-v0", experiment: { rank: index } } : {}),
  };
}

function buildQaSessions() {
  const sessions = [];
  sessions.push(buildQaSession(0, 70, {
    withCitations: true, withTools: true,
    draft: {
      text: "Unsent Q&A draft about the second chapter",
      sections: [
        { id: "sec-1", title: "Chapter 1", documentId: "doc-1" },
        { id: "sec-2", title: "Chapter 2", documentId: "doc-1" },
      ],
      contextPassage: sentence("Selected passage about {a} and {b}."),
    },
    unknownFields: true,
  }));
  sessions.push(buildQaSession(1, 60, { withCitations: true, id: "qa-dup-origin-1" }));
  for (let i = 2; i < 62; i++) {
    sessions.push(buildQaSession(i, int(0, 12), {
      withCitations: i % 2 === 0,
      withTools: i % 5 === 0,
      unknownFields: i % 9 === 0,
      draft: i % 6 === 0
        ? { text: sentence("Draft about {a}"), sections: [] }
        : { text: "", sections: [] },
    }));
  }
  return sessions;
}

/* ------------------------------------------------------------------ */
/* 3. Legacy zustand blob: plethora-document-qa                        */
/* ------------------------------------------------------------------ */

function buildLegacyBlob() {
  // Modern installs hold `{ state: {}, version }` after partialize was emptied.
  const modern = { state: {}, version: 0 };
  // Older installs still hold the last pre-migration message list, including
  // structured citations and a plain-text legacy `[N]` footer answer.
  const legacyMessages = [
    {
      id: "legacy-m0", role: "user", content: "What is the main thesis?",
      timestamp: T0, sourceDocuments: ["doc-1"],
    },
    {
      id: "legacy-m1", role: "assistant",
      content: "The thesis is about attention.\n\nSources: [1] [3]",
      timestamp: T0 + 61_000,
      citations: [makeRagHit("legacy", 0), makeRagHit("legacy", 2)],
      toolCalls: [{
        name: "create_qa_card",
        parameters: { front: "Thesis?", back: "Attention." },
        result: { cardId: "card-legacy-1" },
        status: "success",
      }],
      evidence: { level: "supported", retrievalOnly: false, mode: "semantic", documentCount: 1 },
    },
    {
      id: "legacy-m2", role: "user", content: "And the method?",
      timestamp: T0 + 122_000, plainSourceFooter: "[1] Fixture doc 1",
    },
  ];
  return {
    modern: JSON.stringify(modern),
    legacy: JSON.stringify({ state: { messages: legacyMessages, isProcessing: false }, version: 0 }),
    rawMessagesOnly: JSON.stringify({ messages: legacyMessages }),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Corrupt + oversized inputs                                       */
/* ------------------------------------------------------------------ */

function buildCorrupt() {
  const validSession = buildQaSession(900, 4, { withCitations: true, id: "qa-survivor-1" });
  const validSidebar = buildConversationEntry("survivor", 4, { withCitations: true });
  return {
    qaSessionsMixed: JSON.stringify([
      validSession,
      null,
      42,
      "not-an-object",
      { id: "" },
      { id: "qa-typed-wrong", messages: "should-be-array", updatedAt: "not-a-number" },
      { id: "qa-partial", scope: "not-a-scope", messages: [{ id: "m", role: "assistant", content: 7 }] },
      { messages: [] },
      validSession, // duplicate original ID inside the same origin
    ]),
    sidebarMixed: JSON.stringify({
      survivor: validSidebar,
      "document:broken-1": { messages: [{ id: "broken-1-m0" }], input: "draft", updatedAt: "yesterday" },
      "document:broken-2": "not-an-object",
      "document:broken-3": null,
      "document:dup": buildConversationEntry("dup", 3),
      "document:dup2": buildConversationEntry("dup", 3),
    }),
    truncatedJson: '{"state":{"messages":[{"id":"truncated-m0","role":"user","content":"cut off mid',
    htmlInsteadOfJson: "<!doctype html><html><body>cached error page</body></html>",
    oversizedSession: JSON.stringify(buildQaSession(901, 0, { id: "qa-oversized" })),
  };
}

/** A single session whose serialized JSON exceeds 1 MB (quota stress input). */
function buildOversizedSession() {
  const session = buildQaSession(902, 12, { id: "qa-oversized", withCitations: true });
  const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(400);
  session.messages[1].content = filler;
  // Repeat until the serialized session clearly exceeds 1 MB so the fixture is
  // a real quota-stress input rather than a near miss.
  while (JSON.stringify(session).length <= 1_100_000) {
    session.messages[1].unknownBlob = `${session.messages[1].unknownBlob ?? ""}${filler}`;
  }
  return { session, bytes: JSON.stringify(session).length };
}

/* ------------------------------------------------------------------ */
/* 5. Native SQLite rows (migration 003 shapes)                        */
/* ------------------------------------------------------------------ */

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql() {
  const lines = [
    "-- Fixture rows for the pre-change `ai_conversations` / `ai_messages`",
    "-- schema (migration 003). Task 1.x repositories must read these",
    "-- non-destructively; rows include legacy-only columns that the",
    "-- additive migration must preserve.",
    "BEGIN TRANSACTION;",
    "-- A conversation pointing at a real seeded document plus one orphaned",
    "-- document reference (document_id is nullable / ON DELETE SET NULL).",
  ];
  const conversation = (id, documentId, title, provider, model, created, modified) =>
    `INSERT INTO ai_conversations (id, document_id, title, provider, model, date_created, date_modified) VALUES (${[
      sqlQuote(id), sqlQuote(documentId), sqlQuote(title), sqlQuote(provider),
      sqlQuote(model), sqlQuote(created), sqlQuote(modified),
    ].join(", ")});`;
  const message = (id, conversationId, role, content, timestamp, tokens) =>
    `INSERT INTO ai_messages (id, conversation_id, role, content, timestamp, tokens_used) VALUES (${[
      sqlQuote(id), sqlQuote(conversationId), sqlQuote(role), sqlQuote(content),
      sqlQuote(timestamp), tokens === null ? "NULL" : String(tokens),
    ].join(", ")});`;

  conversation("sql-conv-1", "doc-1", "SQLite legacy conversation", "openai", "gpt-4o-mini", FIXED_EPOCH, FIXED_EPOCH);
  conversation("sql-conv-2", null, "SQLite conversation without document", "ollama", "llama3.1:8b", FIXED_EPOCH, FIXED_EPOCH);
  conversation("sql-conv-3", "doc-1", "SQLite conversation, empty body", "anthropic", "claude-3-5-sonnet", FIXED_EPOCH, FIXED_EPOCH);

  const convInserts = [
    conversation("sql-conv-1", "doc-1", "SQLite legacy conversation", "openai", "gpt-4o-mini", FIXED_EPOCH, FIXED_EPOCH),
    conversation("sql-conv-2", null, "SQLite conversation without document", "ollama", "llama3.1:8b", FIXED_EPOCH, FIXED_EPOCH),
    conversation("sql-conv-3", "doc-1", "SQLite conversation, empty body", "anthropic", "claude-3-5-sonnet", FIXED_EPOCH, FIXED_EPOCH),
    conversation("sql-conv-4", "missing-doc", "SQLite conversation whose document was deleted", "gemini", "gemini-2.0-flash", FIXED_EPOCH, FIXED_EPOCH),
  ];
  lines.push(...convInserts);

  const msgInserts = [];
  for (let i = 0; i < 55; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    msgInserts.push(message(
      `sql-conv-1-m${i}`, "sql-conv-1", role,
      role === "user" ? sentence(pick(questionTemplates)) : sentence(pick(answerTemplates)),
      FIXED_EPOCH, role === "assistant" ? 120 + i : null,
    ));
  }
  msgInserts.push(message("sql-conv-2-m0", "sql-conv-2", "user", "Offline question about local models.", FIXED_EPOCH, null));
  // Orphaned message: conversation_id points at nothing (foreign keys off in
  // raw imports); the importer must quarantine, never attach it to another
  // conversation.
  msgInserts.push(message("sql-orphan-m0", "sql-conv-does-not-exist", "user", "Orphaned legacy row.", FIXED_EPOCH, null));
  // Tokens_used NULL and non-integer legacy value.
  msgInserts.push(message("sql-conv-3-m0", "sql-conv-3", "assistant", "Answer with NULL token count.", FIXED_EPOCH, null));
  lines.push(...msgInserts);
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ */

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const files = {};

function emit(name, content) {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  files[name] = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
  return text;
}

const sidebarText = emit("sidebar-conversations.json", buildSidebar());
const qaText = emit("qa-sessions.json", buildQaSessions());
const legacyText = emit("legacy-document-qa.json", buildLegacyBlob());
const corruptText = emit("corrupt-records.json", buildCorrupt());
const oversized = buildOversizedSession();
const oversizedText = emit("oversized-session.json", oversized.session);
const sqlText = emit("ai-conversations.sql", buildSql());

const counts = {
  sidebarConversationKeys: Object.keys(JSON.parse(sidebarText)).length,
  sidebarMessages: Object.values(JSON.parse(sidebarText)).reduce((n, c) => n + c.messages.length, 0),
  qaSessions: JSON.parse(qaText).length,
  qaMessages: JSON.parse(qaText).reduce((n, s) => n + s.messages.length, 0),
  qaSessionsWithDrafts: JSON.parse(qaText).filter((s) => typeof s.draft?.text === "string" && s.draft.text.length > 0).length,
  qaSessionsWithImages: 0,
  sidebarSessionsWithImages: Object.values(JSON.parse(sidebarText)).filter((c) => c.messages.some((m) => Array.isArray(m.images) && m.images.length > 0)).length,
  corruptVariantInputs: Object.keys(JSON.parse(corruptText)).length,
  oversizedBytes: oversized.bytes,
};

const manifest = {
  purpose:
    "Raw legacy Assistant-storage capture for unify-assistant-experience tasks 0.4/1.5/8.3. " +
    "Generated deterministically; contains no production user data.",
  generator: "scripts/fixtures/generate-legacy-assistant-fixtures.mjs",
  seed: `0x${SEED.toString(16)}`,
  fixedEpoch: FIXED_EPOCH,
  generatedAt: "deterministic-input", // never a wall-clock value
  storageShapes: {
    "sidebar-conversations.json": "assistant-panel-conversations-v1 (StoredConversationMap)",
    "qa-sessions.json": "document-qa-sessions-v1 (DocumentQaSession[])",
    "legacy-document-qa.json": "plethora-document-qa (zustand persist blob, modern + legacy variants)",
    "corrupt-records.json": "malformed/typed-wrong/duplicate inputs for quarantine tests",
    "oversized-session.json": "single >1MB session JSON for quota/stress tests",
    "ai-conversations.sql": "ai_conversations/ai_messages rows for migration 003 schema",
  },
  counts,
  files,
};

emit("manifest.json", manifest);

mkdirSync(OUT_DIR, { recursive: true });
const SOURCES = {
  "sidebar-conversations.json": sidebarText,
  "qa-sessions.json": qaText,
  "legacy-document-qa.json": legacyText,
  "corrupt-records.json": corruptText,
  "oversized-session.json": oversizedText,
  "ai-conversations.sql": sqlText,
};
for (const [name, source] of Object.entries(SOURCES)) {
  writeFileSync(join(OUT_DIR, name), source, "utf8");
}

mkdirSync(FIXTURE_ROOT, { recursive: true });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Full manifest (with hashes): ${MANIFEST_PATH}`);

console.log(`Wrote ${Object.keys(files).length} fixture files to ${OUT_DIR}`);
for (const [name, meta] of Object.entries(files)) {
  console.log(`  ${name}  ${meta.bytes} B  sha256=${meta.sha256.slice(0, 16)}…`);
}
console.log(JSON.stringify(counts, null, 2));

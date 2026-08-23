/**
 * Compile the licensed marketing demo-library into deterministic records for
 * the browser and native capture adapters.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_LIBRARY_DIR = join(ROOT, "marketing/demo-library");
const SOURCE_PATH = join(DEFAULT_LIBRARY_DIR, "library.json");
const OUTPUT_PATHS = [
  join(DEFAULT_LIBRARY_DIR, "generated/marketing-fixture-v2.json"),
  join(ROOT, "src/lib/marketingCapture/generated/marketing-fixture-v2.json"),
];

const FIXTURE_ID = "marketing-fixture-v2";
const FIXTURE_VERSION = "2.0.0";
const ALLOWED_LICENSES = new Set(["CC0-1.0", "Public-Domain"]);
const ALLOWED_EXTENSIONS = new Set([".epub", ".html", ".json", ".md", ".pdf", ".svg", ".wav"]);
const ALLOWED_MEDIA_TYPES = new Map([
  [".epub", "application/epub+zip"],
  [".html", "text/html"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
]);
const REQUIRED_COLLECTIONS = {
  sources: 6,
  files: 5,
  documents: 5,
  queue: 5,
  readingProgress: 5,
  notes: 3,
  extracts: 3,
  learningItems: 5,
  reviewEvents: 5,
  tags: 5,
  connections: 3,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ACCOUNT_RE = /\b(?:account[_ -]?id|customer[_ -]?id|access[_ -]?token|api[_ -]?key)\b/i;
const PERSONAL_PATH_RE = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/;
const REMOTE_URL_RE = /\b(?:https?:|data:|file:|blob:|ftp:)/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function fail(message) {
  throw new Error(`marketing-fixture-v2: ${message}`);
}

function assertArray(source, key, minimum) {
  if (!Array.isArray(source[key]) || source[key].length < minimum) {
    fail(`${key} must contain at least ${minimum} records`);
  }
}

function assertIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (!record || !UUID_RE.test(record.id ?? "")) fail(`${label} has an invalid UUID`);
    if (ids.has(record.id)) fail(`${label} contains duplicate id ${record.id}`);
    ids.add(record.id);
  }
  return ids;
}

function assertRef(ids, id, label) {
  if (!ids.has(id)) fail(`${label} references missing id ${id}`);
}

function validateLocalPath(libraryDir, value, label) {
  if (typeof value !== "string" || !value || isAbsolute(value) || REMOTE_URL_RE.test(value)) {
    fail(`${label} must be a relative local path`);
  }
  const absolute = resolve(libraryDir, value);
  if (absolute !== libraryDir && !absolute.startsWith(`${libraryDir}${sep}`)) {
    fail(`${label} escapes marketing/demo-library`);
  }
  const extension = extname(value).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) fail(`${label} uses unknown file type ${extension || "<none>"}`);
  if (/(?:^|\/)(?:cover|covers)(?:\/|\.|$)/i.test(value)) {
    fail(`${label} looks like an unapproved commercial cover`);
  }
  return absolute;
}

function assertNoPersonalData(source) {
  const serialized = JSON.stringify(source);
  if (EMAIL_RE.test(serialized)) fail("source contains an email address");
  if (ACCOUNT_RE.test(serialized)) fail("source contains an account identifier field or value");
  if (PERSONAL_PATH_RE.test(serialized)) fail("source contains a personal filesystem path");
  if (REMOTE_URL_RE.test(serialized)) fail("source contains a remote or unsafe URL");
}

export function validateMarketingLibrary(source, { libraryDir = DEFAULT_LIBRARY_DIR } = {}) {
  if (!source || typeof source !== "object") fail("source must be an object");
  if (source.fixtureId !== FIXTURE_ID) fail(`fixtureId must be ${FIXTURE_ID}`);
  if (source.version !== FIXTURE_VERSION) fail(`version must be ${FIXTURE_VERSION}`);
  if (source.storyId !== "memory-sleep-cognition") fail("unexpected storyId");
  if (!Number.isInteger(source.seed?.rngSeed) || Number.isNaN(Date.parse(source.seed?.createdAt))) {
    fail("seed must contain a fixed rngSeed and ISO logical time");
  }
  for (const [key, minimum] of Object.entries(REQUIRED_COLLECTIONS)) assertArray(source, key, minimum);
  assertNoPersonalData(source);

  const sourceIds = assertIds(source.sources, "sources");
  const fileIds = assertIds(source.files, "files");
  const documentIds = assertIds(source.documents, "documents");
  const noteIds = assertIds(source.notes, "notes");
  const extractIds = assertIds(source.extracts, "extracts");
  const itemIds = assertIds(source.learningItems, "learningItems");
  const reviewIds = assertIds(source.reviewEvents, "reviewEvents");
  const tagIds = assertIds(source.tags, "tags");
  const connectionIds = assertIds(source.connections, "connections");

  for (const entry of source.sources) {
    if (!ALLOWED_LICENSES.has(entry.license)) fail(`source ${entry.id} has unapproved license ${entry.license}`);
    if (!entry.attribution?.trim()) fail(`source ${entry.id} is missing attribution`);
    const paths = Object.values(entry.paths ?? {});
    if (paths.length === 0) fail(`source ${entry.id} has no media paths`);
    for (const path of paths) validateLocalPath(libraryDir, path, `source ${entry.id}`);
  }

  for (const file of source.files) {
    assertRef(sourceIds, file.sourceId, `file ${file.id}`);
    validateLocalPath(libraryDir, file.path, `file ${file.id}`);
    const expected = ALLOWED_MEDIA_TYPES.get(extname(file.path).toLowerCase());
    if (!expected || expected !== file.mediaType) fail(`file ${file.id} has mismatched mediaType`);
  }
  for (const document of source.documents) {
    assertRef(sourceIds, document.sourceId, `document ${document.id}`);
    assertRef(fileIds, document.fileId, `document ${document.id}`);
    if (document.title.length > 120 || /(?:amazon|goodreads|audible|kindle)/i.test(document.title)) {
      fail(`document ${document.id} has an unsafe or commercial title`);
    }
  }
  for (const entry of source.queue) assertRef(documentIds, entry.documentId, "queue");
  for (const entry of source.readingProgress) assertRef(documentIds, entry.documentId, "readingProgress");
  for (const note of source.notes) assertRef(documentIds, note.documentId, `note ${note.id}`);
  for (const extract of source.extracts) assertRef(documentIds, extract.documentId, `extract ${extract.id}`);
  for (const item of source.learningItems) {
    assertRef(documentIds, item.documentId, `learningItem ${item.id}`);
    if (item.extractId) assertRef(extractIds, item.extractId, `learningItem ${item.id}`);
  }
  for (const event of source.reviewEvents) assertRef(itemIds, event.learningItemId, `reviewEvent ${event.id}`);

  const graphTargets = new Set([...documentIds, ...extractIds, ...noteIds, ...itemIds, ...tagIds]);
  for (const connection of source.connections) {
    assertRef(graphTargets, connection.fromId, `connection ${connection.id}`);
    assertRef(graphTargets, connection.toId, `connection ${connection.id}`);
  }

  const queueDocuments = new Set(source.queue.map((entry) => entry.documentId));
  const progressDocuments = new Set(source.readingProgress.map((entry) => entry.documentId));
  for (const id of documentIds) {
    if (!queueDocuments.has(id) || !progressDocuments.has(id)) fail(`document ${id} lacks queue/progress coverage`);
  }
  const templates = new Set(source.learningItems.map((item) => item.template));
  for (const required of ["basic", "cloze", "mcq", "image-occlusion", "qa"]) {
    if (!templates.has(required)) fail(`learningItems lack required ${required} story coverage`);
  }

  return {
    sourceIds,
    fileIds,
    documentIds,
    extractIds,
    itemIds,
    connectionIds,
    reviewIds,
  };
}

function itemQuestion(item) {
  return item.fields.front ?? item.fields.question ?? item.fields.stem ?? item.fields.prompt ?? item.fields.text ?? "";
}

function itemAnswer(item) {
  if (item.fields.back ?? item.fields.answer) return item.fields.back ?? item.fields.answer;
  if (Array.isArray(item.fields.choices) && Number.isInteger(item.fields.answerIndex)) {
    return item.fields.choices[item.fields.answerIndex] ?? "";
  }
  if (item.template === "cloze") return String(item.fields.text ?? "").replace(/\{\{c\d+::([^}]+)\}\}/g, "$1");
  return "";
}

function textContentFor(document, source, libraryDir) {
  const candidates = Object.values(source.paths).filter((path) => /\.(?:md|html)$/i.test(path));
  const preferred = candidates.find((path) => path.endsWith(".md")) ?? candidates[0];
  return preferred ? readFile(join(libraryDir, preferred), "utf8") : Promise.resolve(document.title);
}

export async function compileMarketingFixture({
  root = ROOT,
  libraryDir = join(root, "marketing/demo-library"),
  source,
  write = true,
  outputPaths,
} = {}) {
  const sourcePath = join(libraryDir, "library.json");
  const loaded = source ?? JSON.parse(await readFile(sourcePath, "utf8"));
  validateMarketingLibrary(loaded, { libraryDir });

  const uniqueMediaPaths = [...new Set(loaded.sources.flatMap((entry) => Object.values(entry.paths)))].sort();
  const media = [];
  for (const path of uniqueMediaPaths) {
    const absolute = validateLocalPath(libraryDir, path, path);
    const bytes = await readFile(absolute);
    media.push({ path, byteSize: bytes.byteLength, sha256: sha256(bytes) });
  }

  const fileById = new Map(loaded.files.map((entry) => [entry.id, entry]));
  const sourceById = new Map(loaded.sources.map((entry) => [entry.id, entry]));
  const progressByDocument = new Map(loaded.readingProgress.map((entry) => [entry.documentId, entry]));
  const extractsByDocument = new Map(loaded.documents.map((document) => [document.id, loaded.extracts.filter((entry) => entry.documentId === document.id)]));
  const itemsByDocument = new Map(loaded.documents.map((document) => [document.id, loaded.learningItems.filter((entry) => entry.documentId === document.id)]));
  const logicalTime = loaded.seed.createdAt;

  const files = [];
  for (const entry of [...loaded.files].sort((a, b) => a.id.localeCompare(b.id))) {
    const bytes = await readFile(join(libraryDir, entry.path));
    const filename = basename(entry.path);
    files.push({
      id: `browser-file://${filename}`,
      source_file_id: entry.id,
      filename,
      content_type: entry.mediaType,
      byte_size: bytes.byteLength,
      sha256: sha256(bytes),
      bytes_base64: bytes.toString("base64"),
      created_at: logicalTime,
    });
  }

  const documents = [];
  for (const entry of [...loaded.documents].sort((a, b) => a.id.localeCompare(b.id))) {
    const file = fileById.get(entry.fileId);
    const sourceEntry = sourceById.get(entry.sourceId);
    const progress = progressByDocument.get(entry.id);
    const content = await textContentFor(entry, sourceEntry, libraryDir);
    documents.push({
      id: entry.id,
      title: entry.title,
      file_path: `browser-file://${basename(file.path)}`,
      file_type: entry.fileType,
      content,
      content_hash: sha256(content),
      current_page: progress.currentPage,
      current_scroll_percent: progress.currentScrollPercent,
      progress_percent: progress.progressPercent,
      category: entry.category,
      tags: [...entry.tags].sort(),
      date_added: logicalTime,
      date_modified: progress.updatedAt,
      extract_count: extractsByDocument.get(entry.id).length,
      learning_item_count: itemsByDocument.get(entry.id).length,
      priority_rating: entry.priorityRating,
      priority_slider: entry.prioritySlider,
      priority_score: entry.priorityScore,
      is_archived: false,
      is_favorite: entry.isFavorite,
      next_reading_date: entry.nextReadingDate,
      reading_count: progress.progressPercent > 0 ? 1 : 0,
      stability: 0,
      difficulty: 0,
      reps: 0,
      total_time_spent: Math.round(progress.progressPercent * 12),
      sync_version: 0,
      metadata: {
        fixtureId: loaded.fixtureId,
        fileId: entry.fileId,
        license: sourceEntry.license,
        attribution: sourceEntry.attribution,
      },
    });
  }

  const extracts = [...loaded.extracts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      document_id: entry.documentId,
      content: entry.text,
      selection_context: { fixtureLocator: entry.locator },
      highlight_color: "#8f72ff",
      notes: entry.notes,
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      date_created: logicalTime,
      date_modified: logicalTime,
      tags: [...entry.tags].sort(),
      category: "Memory",
      next_review_date: logicalTime,
      review_count: 0,
      reps: 0,
      sync_version: 0,
    }));

  const learningItems = [...loaded.learningItems]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry, index) => ({
      id: entry.id,
      extract_id: entry.extractId,
      document_id: entry.documentId,
      item_type: entry.template === "cloze" ? "cloze" : "qa",
      question: itemQuestion(entry),
      answer: itemAnswer(entry),
      cloze_text: entry.template === "cloze" ? entry.fields.text : undefined,
      difficulty: 0.3 + index * 0.05,
      interval: index + 1,
      memory_state: { stability: index + 1, difficulty: 5 + index * 0.25 },
      ease_factor: 2.5,
      due_date: logicalTime,
      date_created: logicalTime,
      date_modified: logicalTime,
      last_review_date: loaded.reviewEvents.find((event) => event.learningItemId === entry.id)?.ratedAt,
      review_count: loaded.reviewEvents.filter((event) => event.learningItemId === entry.id).length,
      lapses: 0,
      state: "review",
      is_suspended: false,
      tags: [...(loaded.documents.find((document) => document.id === entry.documentId)?.tags ?? [])].sort(),
      interaction_metadata: { fixtureTemplate: entry.template, fixtureFields: entry.fields },
      algorithm_type: "fsrs",
      sync_version: 0,
    }));

  const records = {
    documents,
    extracts,
    learningItems,
    files,
    queue: [...loaded.queue].sort((a, b) => a.position - b.position),
    readingProgress: [...loaded.readingProgress].sort((a, b) => a.documentId.localeCompare(b.documentId)),
    reviewEvents: [...loaded.reviewEvents].sort((a, b) => a.ratedAt.localeCompare(b.ratedAt)),
    notes: [...loaded.notes].sort((a, b) => a.id.localeCompare(b.id)),
    tags: [...loaded.tags].sort((a, b) => a.name.localeCompare(b.name)),
    connections: [...loaded.connections].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const sourceHash = sha256(stableJson(loaded));
  const fixtureHash = sha256(stableJson({
    fixtureId: loaded.fixtureId,
    fixtureVersion: loaded.version,
    logicalTime,
    media,
    records,
    sourceHash,
  }));
  const fixture = {
    metadata: {
      schemaVersion: 2,
      fixtureId: loaded.fixtureId,
      fixtureVersion: loaded.version,
      fixtureHash,
      sourceHash,
      storyId: loaded.storyId,
      logicalTime,
      rngSeed: loaded.seed.rngSeed,
      sourcePath: relative(root, sourcePath).split(sep).join("/"),
    },
    media,
    records,
  };

  if (write) {
    const destinations = outputPaths ?? [
      join(libraryDir, "generated/marketing-fixture-v2.json"),
      join(root, "src/lib/marketingCapture/generated/marketing-fixture-v2.json"),
    ];
    const serialized = stableJson(fixture);
    for (const destination of destinations) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, serialized, "utf8");
    }
  }
  return fixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = await compileMarketingFixture({ outputPaths: OUTPUT_PATHS });
  console.log(`Compiled ${fixture.metadata.fixtureId}@${fixture.metadata.fixtureVersion}`);
  console.log(`Fixture hash: ${fixture.metadata.fixtureHash}`);
}

/** Build a deterministic native collection-import archive from fixture v2. */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_PATH = join(ROOT, "marketing/demo-library/generated/marketing-fixture-v2.json");
const NATIVE_IMPORTER_PATH = join(ROOT, "src-tauri/src/commands/collection_archive.rs");
const FIXED_DATE = new Date("2026-08-23T12:00:00.000Z");

function outputPath(argv) {
  const index = argv.indexOf("--out");
  if (index < 0 || !argv[index + 1]) {
    throw new Error("Usage: node scripts/marketing/build-tauri-fixture-import.mjs --out <absolute-or-relative.zip>");
  }
  return resolve(argv[index + 1]);
}

export function assertNativeImporterCompatibility(source) {
  const requiredFragments = [
    'manifest.archive_type != "incrementum-collection-export"',
    'manifest.version != "1.0"',
    'DELETE FROM learning_items',
    'DELETE FROM extracts',
    'DELETE FROM documents',
    'tx.commit().await?',
  ];
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      throw new Error(`Native collection importer compatibility check failed: missing ${fragment}`);
    }
  }
}

function documentRecord(record) {
  return {
    id: record.id,
    title: record.title,
    filePath: record.file_path,
    fileType: record.file_type,
    content: record.content,
    contentHash: record.content_hash,
    currentPage: record.current_page,
    currentScrollPercent: record.current_scroll_percent,
    progressPercent: record.progress_percent,
    category: record.category,
    tags: record.tags,
    dateAdded: record.date_added,
    dateModified: record.date_modified,
    extractCount: record.extract_count,
    learningItemCount: record.learning_item_count,
    priorityRating: record.priority_rating,
    prioritySlider: record.priority_slider,
    priorityScore: record.priority_score,
    isArchived: record.is_archived,
    isFavorite: record.is_favorite,
    isDismissed: false,
    metadata: record.metadata,
    nextReadingDate: record.next_reading_date,
    readingCount: record.reading_count,
    stability: record.stability,
    difficulty: record.difficulty,
    reps: record.reps,
    totalTimeSpent: record.total_time_spent,
  };
}

function extractRecord(record) {
  return {
    id: record.id,
    documentId: record.document_id,
    content: record.content,
    selectionContext: record.selection_context,
    highlightColor: record.highlight_color,
    notes: record.notes,
    progressiveDisclosureLevel: record.progressive_disclosure_level,
    maxDisclosureLevel: record.max_disclosure_level,
    dateCreated: record.date_created,
    dateModified: record.date_modified,
    tags: record.tags,
    category: record.category,
    nextReviewDate: record.next_review_date,
    reviewCount: record.review_count,
    reps: record.reps,
  };
}

function learningItemRecord(record) {
  return {
    id: record.id,
    extractId: record.extract_id,
    documentId: record.document_id,
    itemType: record.item_type,
    question: record.question,
    answer: record.answer,
    clozeText: record.cloze_text,
    difficulty: record.difficulty,
    interval: record.interval,
    easeFactor: record.ease_factor,
    dueDate: record.due_date,
    dateCreated: record.date_created,
    dateModified: record.date_modified,
    lastReviewDate: record.last_review_date,
    reviewCount: record.review_count,
    lapses: record.lapses,
    state: record.state,
    isSuspended: record.is_suspended,
    tags: record.tags,
  };
}

export async function buildTauriFixtureImport(destination) {
  const [fixtureRaw, nativeImporter] = await Promise.all([
    readFile(FIXTURE_PATH, "utf8"),
    readFile(NATIVE_IMPORTER_PATH, "utf8"),
  ]);
  assertNativeImporterCompatibility(nativeImporter);
  const fixture = JSON.parse(fixtureRaw);
  if (fixture.metadata?.fixtureId !== "marketing-fixture-v2" || fixture.metadata?.schemaVersion !== 2) {
    throw new Error("Compile marketing-fixture-v2 before building the native import archive");
  }

  const zip = new JSZip();
  const fileByVirtualPath = new Map(fixture.records.files.map((file) => [file.id, file]));
  const files = [];
  for (const document of fixture.records.documents) {
    const file = fileByVirtualPath.get(document.file_path);
    if (!file) throw new Error(`Missing fixture file for document ${document.id}`);
    const zipPath = `files/${document.id}/${file.filename}`;
    const bytes = Buffer.from(file.bytes_base64, "base64");
    zip.file(zipPath, bytes, { date: FIXED_DATE, createFolders: false });
    files.push({
      documentId: document.id,
      filename: file.filename,
      contentType: file.content_type,
      zipPath,
      size: bytes.byteLength,
    });
  }

  // The current native command intentionally retains the legacy marker for
  // full-replacement archives. The compatibility check above prevents this
  // builder from silently drifting when that command is modernized.
  const manifest = {
    archiveType: "incrementum-collection-export",
    version: "1.0",
    exportedAt: fixture.metadata.logicalTime,
    scope: "all",
    fixtureId: fixture.metadata.fixtureId,
    fixtureHash: fixture.metadata.fixtureHash,
  };
  const payload = {
    documents: fixture.records.documents.map(documentRecord),
    extracts: fixture.records.extracts.map(extractRecord),
    learningItems: fixture.records.learningItems.map(learningItemRecord),
    files,
    collections: { collections: [], activeCollectionId: null, documentAssignments: {} },
    settings: null,
    localStorage: {},
    reviewSessions: [],
    reviewResults: fixture.records.reviewEvents,
    categories: [],
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, { date: FIXED_DATE, createFolders: false });
  zip.file("data/payload.json", `${JSON.stringify(payload, null, 2)}\n`, { date: FIXED_DATE, createFolders: false });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await writeFile(destination, archive);
  return { destination, byteSize: archive.byteLength, fixtureHash: fixture.metadata.fixtureHash };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await buildTauriFixtureImport(outputPath(process.argv.slice(2)));
  console.log(`Wrote ${result.destination}`);
  console.log(`Fixture hash: ${result.fixtureHash}`);
}

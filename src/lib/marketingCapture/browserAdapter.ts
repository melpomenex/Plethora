import fixtureJson from "./generated/marketing-fixture-v2.json";
import {
  closeDatabase,
  getAllExtracts,
  getAllFiles,
  getAllLearningItems,
  getDocuments,
  getSyncState,
  replaceMarketingCaptureFixture,
  type StoredFile,
} from "../database";
import { resolveMarketingCaptureRequest, type MarketingCaptureRequest } from "./capability";
import { isMarketingCaptureNamespace, marketingCaptureNamespace } from "./namespace";
import { commitMarketingCaptureFixture } from "./adapterCore";
import type { MarketingCompiledFixture } from "./types";

const fixture = fixtureJson as unknown as MarketingCompiledFixture;

export interface MarketingCaptureBootstrap {
  request: MarketingCaptureRequest;
  databaseName: string;
  fixtureHash: string;
  counts: {
    documents: number;
    extracts: number;
    learningItems: number;
    files: number;
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function assertStoredFileHashes(files: StoredFile[]): Promise<void> {
  const expectedById = new Map(fixture.records.files.map((record) => [record.id, record]));
  for (const file of files) {
    const expected = expectedById.get(file.id);
    if (!expected) throw new Error(`Unexpected stored fixture file ${file.id}`);
    const digest = await crypto.subtle.digest("SHA-256", await file.blob.arrayBuffer());
    const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actualHash !== expected.sha256 || file.blob.size !== expected.byte_size) {
      throw new Error(`Stored fixture file hash drift for ${file.id}`);
    }
  }
}

export function deleteCaptureDatabase(
  databaseName: string,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  if (!isMarketingCaptureNamespace(databaseName)) {
    return Promise.reject(new Error("Refusing to delete a non-capture IndexedDB namespace"));
  }
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Capture database deletion failed"));
    request.onblocked = () => reject(new Error("Capture database deletion was blocked by an open connection"));
  });
}

export async function prepareMarketingCapture(): Promise<MarketingCaptureBootstrap | null> {
  const request = resolveMarketingCaptureRequest();
  if (!request) return null;
  if (fixture.metadata.fixtureId !== request.fixtureId || fixture.metadata.fixtureVersion !== "2.0.0") {
    throw new Error("Compiled fixture metadata does not match the requested fixture");
  }

  const databaseName = marketingCaptureNamespace(fixture.metadata.fixtureHash);
  await deleteCaptureDatabase(databaseName);
  (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__?: string }).__PLETHORA_CAPTURE_DATABASE__ = databaseName;
  closeDatabase();

  const files: StoredFile[] = fixture.records.files.map((record) => ({
    id: record.id,
    filename: record.filename,
    content_type: record.content_type,
    blob: new Blob([decodeBase64(record.bytes_base64)], { type: record.content_type }),
    created_at: record.created_at,
  }));
  const verifiedCounts = await commitMarketingCaptureFixture(fixture, files, {
    replace: replaceMarketingCaptureFixture,
    readCounts: async () => {
      const [documents, extracts, learningItems, storedFiles, queue] = await Promise.all([
        getDocuments(),
        getAllExtracts(),
        getAllLearningItems(),
        getAllFiles(),
        getSyncState("marketing_fixture_v2:queue"),
      ]);
      await assertStoredFileHashes(storedFiles);
      return {
        documents: documents.length,
        extracts: extracts.length,
        learningItems: learningItems.length,
        files: storedFiles.length,
        queue: Array.isArray(queue) ? queue.length : -1,
      };
    },
  });
  const { queue: _queue, ...counts } = verifiedCounts;
  const bootstrap = { request, databaseName, fixtureHash: fixture.metadata.fixtureHash, counts };
  (globalThis as typeof globalThis & {
    __PLETHORA_MARKETING_CAPTURE__?: MarketingCaptureBootstrap;
  }).__PLETHORA_MARKETING_CAPTURE__ = bootstrap;
  document.documentElement.dataset.marketingCapture = "true";
  document.documentElement.dataset.marketingTheme = request.theme;
  document.documentElement.lang = request.locale;
  // The showcase exercises the review product itself, not first-run education.
  // Seed the same persisted dismissal a returning user would already have.
  localStorage.setItem("plethora_fsrs_explanation_shown", "true");
  document.body.dataset.marketingFixtureCommitted = "true";
  document.body.dataset.marketingFixtureVersion = fixture.metadata.fixtureVersion;
  document.body.dataset.marketingFixtureHash = fixture.metadata.fixtureHash;
  document.body.dataset.marketingBuildId = __PLETHORA_BUILD_ID__;
  return bootstrap;
}

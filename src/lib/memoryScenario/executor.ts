/**
 * Memory-scenario step executor.
 *
 * Executes the driver's steps through the SAME store actions the UI uses
 * (design D2): documents are opened via `openDocumentAtLocation` (the shared
 * helper behind the command palette and Document Q&A), tabs are closed via
 * `tabsStore.closeTab` / `closeAllTabs`, and corpus files are registered via
 * `documentStore.importGenericFile` (an explicit-path import — no file
 * picker). Nothing here synthesizes input events, so runs are deterministic
 * regardless of window geometry, theme, or animation.
 */

import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore } from "../../stores/tabsStore";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import type { Document } from "../../types/document";
import type { AudioEdition, AudioEditionSection } from "../../types/audioEdition";
import { createAudioEdition, deleteAudioEdition } from "../../api/audioEditions";
import {
  useAudioEditionGenerationStore,
} from "../../stores/audioEditionGenerationStore";
import { getCachedAudio, makeTTSCacheKeyV2, setCachedAudioDurable } from "../../utils/ttsCache";
import { createOwnedObjectUrl, revokeOwnedObjectUrl } from "../../diagnostics/ownedObjectUrl";
import { getDiagnosticSnapshot } from "../../diagnostics/resourceCounts";
import type { MemoryScenarioManifest, MemoryScenarioStep } from "./types";
import {
  SCENARIO_SYNTH_MODEL,
  SCENARIO_SYNTH_PROVIDER,
  synthAudioBytes,
  synthDurationSec,
} from "./scenarioSynth";

export interface ExecuteResult {
  ok: boolean;
  tabId?: string;
  documentId?: string;
  diagnostics?: unknown;
  error?: string;
}

const documentIdByCorpusId = new Map<string, string>();

/** Synthetic-leak sink (task 4.3): non-empty only in scenario mode with the
 *  env set; asserted absent in production-config tests. */
const syntheticLeakSink: ArrayBuffer[] = [];
let syntheticLeakMbPerCycle = 0;

/** Configured once by the host when the harness env is present. */
export function configureSyntheticLeak(mbPerCycle: number): void {
  syntheticLeakMbPerCycle = mbPerCycle > 0 ? mbPerCycle : 0;
}

export function getSyntheticLeakSinkSize(): number {
  return syntheticLeakSink.length;
}

/** Retain the configured MB for this cycle step (gate self-test, D11). */
function injectSyntheticLeak(): void {
  if (syntheticLeakMbPerCycle <= 0) return;
  syntheticLeakSink.push(new ArrayBuffer(syntheticLeakMbPerCycle * 1024 * 1024));
}

/** Result of opening/importing a corpus item. */
export async function resolveDocument(
  corpusId: string,
  manifest: MemoryScenarioManifest,
): Promise<Document> {
  const cached = documentIdByCorpusId.get(corpusId);
  if (cached) {
    const known = useDocumentStore.getState().documents.find((d) => d.id === cached);
    if (known) return known;
  }

  const fileName = manifest.items[corpusId];
  if (!fileName) {
    throw new Error(`corpus item "${corpusId}" is not in the manifest`);
  }
  const filePath = `${manifest.corpusDir}/${fileName}`;

  // Prefer an existing document row for this path so repeated harness runs do
  // not accumulate duplicate imports; import only when the path is unknown.
  let doc = useDocumentStore.getState().documents.find((d) => d.filePath === filePath);
  if (!doc) {
    await useDocumentStore.getState().loadDocuments();
    doc = useDocumentStore.getState().documents.find((d) => d.filePath === filePath);
  }
  if (!doc) {
    doc = await useDocumentStore.getState().importGenericFile(filePath);
  }

  documentIdByCorpusId.set(corpusId, doc.id);
  return doc;
}

/** Find the currently open tab holding a document (document-viewer dedupes on data). */
export function findTabForDocument(documentId: string): { tabId: string } | null {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(
    (t) => t.type === "document-viewer" && t.data?.documentId === documentId,
  );
  return tab ? { tabId: tab.id } : null;
}

/** Long-text corpus fixture used for deterministic synthesis volume. */
const LONG_TEXT_CORPUS_ID = "long-text-1";

async function loadLongText(manifest: MemoryScenarioManifest): Promise<string> {
  const cached = longTextCache.get(manifest.corpusDir);
  if (cached) return cached;
  const fileName = manifest.items[LONG_TEXT_CORPUS_ID];
  if (!fileName) throw new Error(`corpus item "${LONG_TEXT_CORPUS_ID}" is not in the manifest`);
  const { readFileText } = await import("./corpusFile");
  const text = await readFileText(`${manifest.corpusDir}/${fileName}`);
  longTextCache.set(manifest.corpusDir, text);
  return text;
}
const longTextCache = new Map<string, string>();

/**
 * One TTS cycle (task 4.1): synthesize (or fetch from the persistent cache)
 * → play → stop → dispose — through the same cache-key, persistent-cache, and
 * owned-URL paths the reader UI uses. `variant: "hit"` reuses one fixed text
 * so cycles after the first take the cache-hit path; `"miss"` salts the text
 * per cycle so every synthesis misses.
 */
async function runTtsCycle(
  variant: "hit" | "miss",
  cycle: number,
  manifest: MemoryScenarioManifest,
): Promise<void> {
  const baseText = await loadLongText(manifest);
  const chunk = baseText.slice(0, 2_000);
  const text = variant === "hit" ? chunk : `${chunk}\n[cycle ${cycle}]`;
  const key = makeTTSCacheKeyV2({
    provider: SCENARIO_SYNTH_PROVIDER,
    model: SCENARIO_SYNTH_MODEL,
    voice: "scenario",
    speed: 1,
    format: "mp3",
    text,
  });

  const cached = await getCachedAudio(key);
  let url: string;
  let bytes: ArrayBuffer;
  if (cached) {
    bytes = cached.audioData;
    url = createOwnedObjectUrl(new Blob([bytes], { type: "audio/mpeg" }), {
      owner: "tts-cache-hit",
      ownerId: key,
    });
  } else {
    bytes = synthAudioBytes(text);
    await setCachedAudioDurable(key, bytes, synthDurationSec(text));
    url = createOwnedObjectUrl(new Blob([bytes], { type: "audio/mpeg" }), {
      owner: "tts-synthesis",
      ownerId: key,
    });
  }

  // play → stop: a real media element load exercises WebKit's audio
  // pipeline; muted to keep autoplay policy out of the deterministic path.
  const audio = new Audio(url);
  audio.muted = true;
  audio.preload = "auto";
  const loaded = new Promise<void>((resolve) => {
    audio.addEventListener("canplaythrough", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 2_000);
  });
  try {
    await audio.play().catch(() => {});
    await loaded;
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
  } finally {
    // dispose
    revokeOwnedObjectUrl(url);
  }
}

let editionCycleCounter = 0;

/**
 * One audio-edition cycle (task 4.1): generate K sections → play → cancel
 * mid-run → delete edition → retry → cleanup — driving the same generation
 * store actions the UI uses (startJob/cancelJob/deleteAudioEdition).
 */
async function runEditionCycle(
  sections: number,
  cycle: number,
  manifest: MemoryScenarioManifest,
): Promise<void> {
  const baseText = await loadLongText(manifest);
  editionCycleCounter += 1;
  const editionId = `scenario-edition-${cycle}-${editionCycleCounter}`;
  const documentId = "scenario-document";
  const now = Date.now();

  const makeSections = (salt: string): AudioEditionSection[] =>
    Array.from({ length: sections }, (_, i) => ({
      id: `${editionId}-section-${i}${salt}`,
      editionId,
      sectionIndex: i,
      title: baseText.slice(i * 500, i * 500 + 400) || `Section ${i}${salt}`,
      sourceStartAnchor: String(i * 500),
      characterCount: 400,
      audioMimeType: "audio/mpeg",
      durationSec: 0,
      generationStatus: "queued" as const,
      retryCount: 0,
      cacheKey: `${editionId}:${i}${salt}`,
      createdAt: now,
      updatedAt: now,
    }));

  const edition: AudioEdition = {
    id: editionId,
    sourceDocumentId: documentId,
    sourceRevisionHash: "scenario",
    provider: SCENARIO_SYNTH_PROVIDER,
    model: SCENARIO_SYNTH_MODEL,
    voice: "scenario",
    generationSettings: null,
    totalDurationSec: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  const textMapOf = (secs: AudioEditionSection[]) =>
    Object.fromEntries(secs.map((s, i) => [s.id, baseText.slice(i * 500, i * 500 + 400)]));

  try {
    // generate K sections (first half completes, then cancel mid-run)
    const first = makeSections("");
    await createAudioEdition(edition, first);
    const started = useAudioEditionGenerationStore.getState().startJob(editionId, textMapOf(first));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await useAudioEditionGenerationStore.getState().cancelJob(editionId);
    await Promise.race([started, new Promise((r) => setTimeout(r, 500))]);

    // retry: a fresh edition over the same document
    const retry = makeSections("-r");
    await createAudioEdition({ ...edition, status: "draft" }, retry);
    const retryRun = useAudioEditionGenerationStore.getState().startJob(editionId, textMapOf(retry));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await useAudioEditionGenerationStore.getState().cancelJob(editionId);
    await Promise.race([retryRun, new Promise((r) => setTimeout(r, 500))]);
  } finally {
    // cleanup: delete the edition (must revoke its section URLs)
    try {
      await deleteAudioEdition(editionId);
    } catch {
      // best-effort; the store teardown still runs below
    }
  }
}

/**
 * Execute one step. Returns the report payload fields (tab id for `open`).
 */
export async function executeStep(
  step: MemoryScenarioStep,
  manifest: MemoryScenarioManifest,
): Promise<ExecuteResult> {
  try {
    switch (step.op) {
      case "open": {
        injectSyntheticLeak();
        const doc = await resolveDocument(step.corpusId, manifest);
        openDocumentAtLocation(doc.id, {}, useTabsStore.getState().addTab);
        const opened = findTabForDocument(doc.id);
        return { ok: true, tabId: opened?.tabId, documentId: doc.id };
      }
      case "closeTab": {
        useTabsStore.getState().closeTab(step.tabId);
        return { ok: true };
      }
      case "closeAll": {
        useTabsStore.getState().closeAllTabs();
        return { ok: true };
      }
      case "ttsCycle": {
        injectSyntheticLeak();
        await runTtsCycle(step.variant, step.cycle, manifest);
        return { ok: true };
      }
      case "editionCycle": {
        injectSyntheticLeak();
        await runEditionCycle(step.sections, step.cycle, manifest);
        return { ok: true };
      }
      case "diagnostics":
        return { ok: true, diagnostics: await getDiagnosticSnapshot() };
      case "settle":
        // Quiescence is awaited by the host before reporting; nothing to do.
        return { ok: true };
      case "quit":
        return { ok: true };
      default:
        return { ok: false, error: `unhandled op ${(step as { op: string }).op}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

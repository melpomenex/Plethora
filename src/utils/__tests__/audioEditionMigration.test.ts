/**
 * Legacy audiobook migration tests (task 1.5 / 11.7): `runLegacyAudiobookMigration`
 * converts localStorage `audiobook-*` records into Audio Editions idempotently
 * (guarded by a completion flag + per-document edition checks), including
 * transcript-segment → anchor conversion.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../api/documents", () => ({
  getDocuments: vi.fn(async () => [
    {
      id: "doc-mig-1",
      title: "The First Book",
      filePath: "/books/first.mp3",
      metadata: { author: "Author One" },
    },
    {
      id: "doc-mig-2",
      title: "The Second Book",
      filePath: "/books/second.m4b",
      metadata: {},
    },
  ]),
}));

// Browser-mode audio edition store (no Tauri).
vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error("invokeCommand must not be called in browser mode");
  }),
}));

import { runLegacyAudiobookMigration } from "../../utils/audioEditionMigration";
import { getAudioEditionByDocument, listAudioEditions } from "../../api/audioEditions";

describe("runLegacyAudiobookMigration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("converts a legacy localStorage audiobook into an Audio Edition with one section", async () => {
    localStorage.setItem(
      "audiobook-doc-mig-1",
      JSON.stringify({
        metadata: { title: "The First Book", duration: 3600, narrator: "Voice" },
        chapters: [{ title: "Chapter One", startTime: 0, endTime: 1800 }, { title: "Chapter Two", startTime: 1800, endTime: 3600 }],
      })
    );

    const result = await runLegacyAudiobookMigration(true);
    expect(result.migratedCount).toBe(1);

    const edition = await getAudioEditionByDocument("doc-mig-1");
    expect(edition).not.toBeNull();
    expect(edition!.provider).toBe("legacy");
    expect(edition!.status).toBe("ready");
    expect(edition!.totalDurationSec).toBe(3600);
    expect(edition!.sections).toHaveLength(2);
    expect(edition!.sections![0].title).toBe("Chapter One");
  });

  it("converts transcript segments into anchors on the primary section", async () => {
    localStorage.setItem(
      "audiobook-doc-mig-2",
      JSON.stringify({
        metadata: { title: "The Second Book", duration: 120 },
        transcript: {
          segments: [
            { startTime: 0, endTime: 10, text: "Hello from the transcript." },
            { startTime: 10, endTime: 20, text: "A second segment." },
          ],
        },
      })
    );

    const { getAudioEditionAnchors } = await import("../../api/audioEditions");
    const result = await runLegacyAudiobookMigration(true);
    expect(result.migratedCount).toBe(1);

    const edition = await getAudioEditionByDocument("doc-mig-2");
    expect(edition).not.toBeNull();
    const anchors = await getAudioEditionAnchors(edition!.sections![0].id);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ audioStartSec: 0, audioEndSec: 10, textContent: "Hello from the transcript." });
  });

  it("is idempotent: the completion flag prevents a second run", async () => {
    localStorage.setItem(
      "audiobook-doc-mig-1",
      JSON.stringify({ metadata: { title: "The First Book", duration: 60 } })
    );

    await runLegacyAudiobookMigration(false);
    const second = await runLegacyAudiobookMigration(false);
    expect(second.migratedCount).toBe(0);

    const all = await listAudioEditions();
    expect(all.filter((e) => e.sourceDocumentId === "doc-mig-1")).toHaveLength(1);
  });

  it("skips documents that already have an edition (per-document check)", async () => {
    localStorage.setItem(
      "audiobook-doc-mig-1",
      JSON.stringify({ metadata: { title: "The First Book", duration: 60 } })
    );
    await runLegacyAudiobookMigration(true);

    // Force a re-run (flag cleared): the existing edition must be kept.
    localStorage.removeItem("audio-edition-legacy-migration-completed");
    localStorage.setItem(
      "audiobook-doc-mig-1",
      JSON.stringify({ metadata: { title: "The First Book", duration: 90 } })
    );
    const again = await runLegacyAudiobookMigration(false);
    expect(again.skippedCount).toBe(1);
    expect(again.migratedCount).toBe(0);
  });

  it("ignores stats/dnf/volume/rate/bookmarks pseudo-keys", async () => {
    localStorage.setItem("audiobook-doc-mig-1-stats", "{}");
    localStorage.setItem("audiobook-doc-mig-1-dnf", "true");
    localStorage.setItem("audiobook-doc-mig-1-volume", "0.5");
    localStorage.setItem("audiobook-doc-mig-1-rate", "1.5");
    localStorage.setItem("audiobook-doc-mig-1-bookmarks", "[]");

    const result = await runLegacyAudiobookMigration(true);
    expect(result.migratedCount).toBe(0);
    // No editions exist for the pseudo-key document ids (the two editions in
    // the store come from earlier tests in this file).
    const all = await listAudioEditions();
    expect(
      all.some((e) => /doc-mig-1-(stats|dnf|volume|rate|bookmarks)/.test(e.sourceDocumentId))
    ).toBe(false);
  });

  it("corrupt legacy JSON is skipped without failing the run", async () => {
    localStorage.setItem("audiobook-doc-mig-1", "{not json");
    const result = await runLegacyAudiobookMigration(true);
    expect(result.migratedCount).toBe(0);
  });
});

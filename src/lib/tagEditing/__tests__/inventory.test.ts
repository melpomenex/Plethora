import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Inventory regression check (openspec change
 * unify-tag-editing-and-align-schedule-grid, task 4.5).
 *
 * Mirrors the checked-in inventory in docs/tag-surface-inventory.md:
 * - Every audited PERSISTED-item tag presentation must use the shared editor
 *   (`ItemTagEditor` or `CompactTagEditor`) — otherwise the surface is passive
 *   again and this test fails.
 * - Every documented ALLOWED EXCEPTION must remain free of the shared editor
 *   (non-mutating by design) and be listed in the inventory doc.
 *
 * Keep this list in sync with docs/tag-surface-inventory.md when surfaces
 * change; the doc is the human-readable source of truth.
 */

const ROOT = resolve(__dirname, "../../../..");

const ADOPTED_SURFACES: { file: string; note: string }[] = [
  { file: "src/components/common/ItemDetailsPopover.tsx", note: "Queue/Review Queue detail popover (inline; rss branch read-only)" },
  { file: "src/components/schedule/ScheduleItemDetails.tsx", note: "Schedule Agenda + Data grid expanded detail (inline)" },
  { file: "src/components/documents/DocumentsView.tsx", note: "Document library rows/cards/inspector + card search results (compact/inline)" },
  { file: "src/components/extracts/ExtractInbox.tsx", note: "Extract inbox item (compact)" },
  { file: "src/components/extracts/ExtractsList.tsx", note: "Extract list item (compact)" },
  { file: "src/components/tabs/WebBrowserTab.tsx", note: "Saved web extract list (compact)" },
  { file: "src/components/learning/LearningCardsList.tsx", note: "Learning cards list (compact)" },
  { file: "src/components/review/ReviewCard.tsx", note: "Review session card header (compact)" },
  { file: "src/components/review/CardPreviewPanel.tsx", note: "Card preview footer (compact)" },
  { file: "src/components/review/DeckManagerCardRow.tsx", note: "Deck Manager card row (compact)" },
  { file: "src/components/review/SemanticGraphPanel.tsx", note: "Semantic Graph selected-item detail (compact; rss branch read-only)" },
  { file: "src/routes/queue.tsx", note: "Legacy queue list item (compact)" },
];

/** Allowed exceptions must NOT import the shared editor. */
const EXCEPTION_SURFACES: { file: string; reason: string }[] = [
  { file: "src/components/media/RSSReader.tsx", reason: "RSS relational tag system" },
  { file: "src/components/media/TagManagementView.tsx", reason: "RSS relational tag system" },
  { file: "src/components/media/TagInput.tsx", reason: "RSS relational tag system" },
  { file: "src/components/import/ImportPreview.tsx", reason: "pre-persistence import preview" },
  { file: "src/components/import/ImportDialog.tsx", reason: "pre-persistence import preview" },
  { file: "src/components/import/WebArticleImportDialog.tsx", reason: "pre-persistence import preview" },
  { file: "src/components/media/YouTubeImport.tsx", reason: "import source metadata" },
  { file: "src/components/import/AudiobookImportDialog.tsx", reason: "import source metadata (internal tags)" },
  { file: "src/components/import/TagSuggestions.tsx", reason: "AI-suggested derived tags" },
  { file: "src/components/extracts/DeleteConfirmDialog.tsx", reason: "destructive confirmation summary" },
  { file: "src/components/queue/ExportQueueDialog.tsx", reason: "export output" },
  { file: "src/components/video/VideoExtracts.tsx", reason: "video extract separate table" },
];

function fileContent(rel: string): string {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) return "";
  return readFileSync(abs, "utf8");
}

function usesSharedEditor(content: string): boolean {
  return content.includes("ItemTagEditor") || content.includes("CompactTagEditor");
}

describe("tag-surface inventory regression (4.5)", () => {
  it.each(ADOPTED_SURFACES)("$file uses the shared editor ($note)", ({ file }) => {
    const content = fileContent(file);
    expect(content.length).toBeGreaterThan(0);
    expect(usesSharedEditor(content), `${file} must use ItemTagEditor/CompactTagEditor`).toBe(true);
  });

  it.each(EXCEPTION_SURFACES)("$file stays non-mutating ($reason)", ({ file }) => {
    const content = fileContent(file);
    expect(content.length).toBeGreaterThan(0);
    expect(
      usesSharedEditor(content),
      `${file} is a documented exception (${"$reason"}) and must NOT use the shared mutation editor`
    ).toBe(false);
  });

  it("documents every exception in docs/tag-surface-inventory.md", () => {
    const doc = fileContent("docs/tag-surface-inventory.md");
    expect(doc.length).toBeGreaterThan(0);
    for (const { file } of EXCEPTION_SURFACES) {
      const baseName = file.split("/").pop() ?? file;
      expect(
        doc.includes(baseName),
        `${file} must be documented in docs/tag-surface-inventory.md`
      ).toBe(true);
    }
  });
});

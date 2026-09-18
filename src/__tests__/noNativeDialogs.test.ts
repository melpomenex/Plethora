import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { globSync } from "node:fs";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The desktop WebView suppresses native JavaScript dialogs.
 *
 * wry's WKUIDelegate (`src/wkwebview/class/wry_web_view_ui_delegate.rs`)
 * implements only `windowWillClose:`, `runOpenPanelWithParameters:`,
 * `requestMediaCapturePermissionForOrigin:` and
 * `createWebViewWithConfiguration:`. WKWebView silently skips any JS dialog
 * whose delegate method is missing, so in the packaged app:
 *
 *   window.alert()   — never shown
 *   window.confirm() — returns false, so every guarded action declines
 *   window.prompt()  — returns null, so every input flow aborts
 *
 * This produced controls that rendered normally and did nothing at all:
 * Documents ▸ Tag/Reprioritize/Move, notification-settings reset, settings
 * discard/reset, and discarding an algorithm-arena session. Use `useModal()`
 * from `src/components/common/Modal.tsx` instead — it returns a Promise and
 * renders in-app.
 */
const FORBIDDEN = /(?<![\w.$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/g;

/** Blank out comments so prose mentioning these APIs is not flagged. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
}

/** Not application code, or legitimately not running in the WebView. */
const EXEMPT = [
  "src/__tests__/noNativeDialogs.test.ts",
  // The Modal implementation names its own methods alert/confirm/prompt.
  "src/components/common/Modal.tsx",
];

/**
 * Files that still call native dialogs and have not been migrated yet.
 *
 * This baseline exists so the migration can proceed file by file without the
 * guard failing the suite in the meantime. It must only ever shrink — adding a
 * file here to silence a new violation defeats the purpose. Delete an entry
 * once that file uses `useModal()`, and delete the list when it is empty.
 */
const PENDING_MIGRATION = [
  "src/components/auth/LoginModal.tsx",
  "src/components/common/ItemDetailsPopover.tsx",
  "src/components/learning/LearningCardsList.tsx",
  "src/components/media/ClipExtractor.tsx",
  "src/components/media/FolderContextMenu.tsx",
  "src/components/media/MediaLibrary.tsx",
  "src/components/media/RSSReader.tsx",
  "src/components/media/YouTubePlaylistManager.tsx",
  "src/components/newsletter/NewsletterDirectory.tsx",
  "src/components/newsletter/NewsletterDirectoryEnhanced.tsx",
  "src/components/newsletter/NewsletterPreviewModal.tsx",
  "src/components/queue/QueueContextMenu.tsx",
  "src/components/settings/AIProviderSettings.tsx",
  "src/components/settings/AISettings.tsx",
  "src/components/settings/ImportExportSettings.tsx",
  "src/components/settings/LLMProviderSettings.tsx",
  "src/components/settings/MCPServersSettings.tsx",
  "src/components/settings/SyncSettings.tsx",
  "src/components/settings/ThemePicker.tsx",
  "src/components/settings/UserProfilePanel.tsx",
  "src/components/settings/VoiceBrowser.tsx",
  "src/components/sync/OfflineSyncIndicator.tsx",
  "src/components/tabs/AudiobooksTab.tsx",
  "src/components/tabs/ScreenshotTab.tsx",
  "src/components/video/VideoExtracts.tsx",
  "src/pages/NotebookLMPage.tsx",
];

function collectSourceFiles(): string[] {
  return globSync("**/*.{ts,tsx}", { cwd: srcRoot })
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !file.includes("__tests__/") && !file.includes("/e2e/"))
    .map((file) => `src/${file}`)
    .filter((file) => !EXEMPT.includes(file) && !PENDING_MIGRATION.includes(file));
}

describe("native JavaScript dialogs", () => {
  it("are not used anywhere in application source", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles()) {
      const absolute = join(srcRoot, relative("src", file));
      const source = stripComments(readFileSync(absolute, "utf8"));
      for (const match of source.matchAll(FORBIDDEN)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line} — ${match[0].trim()}`);
      }
    }

    expect(
      offenders,
      `Native dialogs do not work in the desktop WebView; use useModal() instead.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

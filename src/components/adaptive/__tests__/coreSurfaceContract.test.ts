import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

const surfaces = [
  ["dashboard", "src/components/tabs/DashboardTab.tsx", ["AdaptiveContentHeader", "SafeScrollContainer"]],
  ["queue", "src/components/mobile/MobileQueueView.tsx", ['data-responsive-surface="queue"', "w-full min-w-0"]],
  ["review", "src/components/review/ReviewHome.tsx", ["AdaptiveContentHeader", "SafeScrollContainer"]],
  ["documents", "src/components/documents/DocumentsView.tsx", ["AdaptiveContentHeader", "AdaptiveInspector"]],
  ["analytics", "src/components/tabs/AnalyticsTab.tsx", ["AdaptiveContentHeader", "SafeScrollContainer"]],
  ["settings", "src/components/settings/SettingsPage.tsx", ["AdaptiveContentHeader", "StickyActionBar"]],
  ["search", "src/components/search/GlobalSearch.tsx", ["adaptive-search-panel", 'data-responsive-surface="search-import"']],
  ["import", "src/components/import/ImportDialog.tsx", ["ResponsiveDialogSheet", "responsive-import-dialog"]],
] as const;

describe("core responsive surface migration", () => {
  for (const [name, file, contracts] of surfaces) {
    it(`${name} uses the shared adaptive contract`, () => {
      const source = readFileSync(resolve(root, file), "utf8");
      for (const contract of contracts) {
        expect(source).toContain(contract);
      }
    });
  }
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Queue settings must have exactly one home.
 *
 * Adaptive ranking and Smart Queues were briefly two tabs. They are not two
 * things — both answer "how does my queue behave" — and splitting them meant a
 * reader who configured a decision model in one place saw different state in the
 * other, with no way to tell which was true.
 *
 * These assertions are the guard against that coming back, and against the two
 * half-reasons it happened: a second tab, and a second stored copy of the same
 * preset.
 */

const root = join(process.cwd(), "src");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const SETTINGS_PAGE = "components/settings/SettingsPage.tsx";
const STORE = "stores/settingsStore.ts";

describe("one home for queue settings", () => {
  it("has no separate adaptive-ranking tab", () => {
    const page = source(SETTINGS_PAGE);
    expect(page).not.toContain("AdaptiveRanking");
    expect(page).not.toContain("adaptive-ranking");
  });

  it("has no AdaptiveRankingSettings component left on disk", () => {
    // The file is the tab. If it ever comes back, the tab is back.
    expect(() => readFileSync(join(root, "components/settings/AdaptiveRankingSettings.tsx"), "utf8"))
      .toThrow();
  });

  it("keeps adaptive ranking inside Smart Queues", () => {
    const panel = source("components/settings/SmartQueuesSettings.tsx");
    expect(panel).toContain("DaqeKnobPanel");
    expect(panel).toContain("DaqeDecisionModelSettings");
  });

  it("keeps auto-refresh, which ranking has nothing to do with", () => {
    // Auto-refresh is a plain poller; folding it into the ranking section would
    // have been a strange thing to do, so it stayed its own block in the same tab.
    const panel = source("components/settings/SmartQueuesSettings.tsx");
    expect(panel).toContain("autoRefresh");
    expect(panel).toContain("refreshInterval");
  });

  it("re-ranks when the provider changes", () => {
    // The knob panel's rerank callback used to be a no-op in this surface, so
    // moving a slider here changed nothing until a reload.
    const panel = source("components/settings/SmartQueuesSettings.tsx");
    expect(panel).toContain("applyRankSnapshot");
    expect(panel).toContain("onProviderChange={rerank}");
  });

  it("puts the decision-model search terms on the surviving tab", () => {
    const page = source(SETTINGS_PAGE);
    for (const term of ["decision model", "jev", "laya", "clef", "openrouter", "download model"]) {
      expect(page).toContain(`"${term}"`);
    }
  });
});

describe("one stored copy of the selected preset", () => {
  it("stores the preset only in smartQueue.queueStrategyPreset", () => {
    // `daqe.activePreset` was a second field for the same fact, written by three
    // surfaces. Two fields for one concept is how they drift, and they had.
    expect(source(STORE)).not.toContain("activePreset");
  });

  it("derives attribution from the knobs instead", () => {
    for (const path of [
      "components/queue/DaqeKnobPanel.tsx",
      "components/settings/SmartQueuesSettings.tsx",
    ]) {
      const file = source(path);
      // The panel derives internally; nothing reads a stored mirror.
      expect(file).not.toMatch(/activePreset\s*=\s*\{/);
    }
    expect(source("components/queue/DaqeKnobPanel.tsx")).toContain("detectActivePreset");
  });

  it("does not pass the removed prop to the knob panel", () => {
    for (const path of [
      "components/settings/SmartQueuesSettings.tsx",
      "components/review/SessionCustomizeModal.tsx",
      "components/review/ReviewQueueView.tsx",
    ]) {
      expect(source(path)).not.toContain("activePreset=");
    }
  });

  it("tells the reader when their sliders no longer match a preset", () => {
    // The old note was gated on the stored field and re-printed the scope note,
    // so diverging silently. Divergence is now derived and stated.
    const panel = source("components/queue/DaqeKnobPanel.tsx");
    expect(panel).toContain("detected === null");
    expect(panel).toContain('t("daqeKnob.divergedNote")');
  });
});

describe("one decision-model component", () => {
  it("is defined once and mounted by the surfaces that need it", () => {
    const picker = source("components/queue/DaqeDecisionModelSettings.tsx");
    expect(picker).toContain("export const DaqeDecisionModelSettings");

    // Smart Queue Settings and the Customize Session dialog both mount it.
    expect(source("components/settings/SmartQueuesSettings.tsx")).toContain(
      "DaqeDecisionModelSettings",
    );
    expect(source("components/review/SessionCustomizeModal.tsx")).toContain(
      "DaqeDecisionModelSettings",
    );
    // And nowhere else: a third copy would be a third source of truth.
    expect(source("components/review/ReviewQueueView.tsx")).not.toContain(
      "DaqeDecisionModelSettings",
    );
  });

  it("keeps the keychain handling in the one component that owns it", () => {
    const picker = source("components/queue/DaqeDecisionModelSettings.tsx");
    expect(picker).toContain("setDecisionApiKey");
    expect(picker).toContain("clearDecisionApiKey");
    expect(picker).toContain("getMaskedApiKey");
    // No other settings surface may write a credential.
    expect(source("components/settings/SmartQueuesSettings.tsx")).not.toMatch(
      /decisionApiKey\s*:/,
    );
  });

  it("renders the Laya download from the shared picker", () => {
    expect(source("components/queue/DaqeDecisionModelSettings.tsx")).toContain(
      "DaqueDecisionModelDownload",
    );
  });
});

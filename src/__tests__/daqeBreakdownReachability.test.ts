import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The breakdown has to be reachable from every queue surface, or "no ranking
 * surface shows a bare total" is true on desktop and false on a phone.
 *
 * Source-level assertions rather than rendered ones: the wiring is three prop
 * pass-throughs, and a render test for each would mostly re-assert that React
 * passes props down. What matters is that no surface is *forgotten*, which is
 * exactly what a file-content check catches.
 */

const root = join(process.cwd(), "src");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const SHEET = "components/queue/QueueItemActionSheet.tsx";

describe("ranking breakdown reachability", () => {
  it("renders the breakdown in the shared item action sheet", () => {
    const sheet = source(SHEET);
    expect(sheet).toContain("DaqeScoreBreakdown");
    // Above the actions, not below: a reader opening the sheet to understand a row
    // should get the explanation before the buttons.
    const breakdownAt = sheet.indexOf("DaqeScoreBreakdown");
    const actionsAt = sheet.indexOf("actionButtonClass");
    expect(breakdownAt).toBeGreaterThan(-1);
    expect(breakdownAt).toBeLessThan(actionsAt);
  });

  it("accepts the breakdown and the configured energy target as optional props", () => {
    const sheet = source(SHEET);
    expect(sheet).toContain("rankBreakdown?: TermBreakdown");
    expect(sheet).toContain("configuredEnergyTarget?: number");
  });

  it("omits the section entirely when there is no breakdown", () => {
    // Guarding on the prop rather than rendering an empty panel matters: with
    // ranking off, the sheet must look exactly as it always did.
    expect(source(SHEET)).toContain("rankBreakdown ? (");
  });

  it.each([
    ["the mobile queue", "components/mobile/MobileQueueView.tsx"],
    ["the desktop queue", "components/review/ReviewQueueView.tsx"],
    ["the standalone queue route", "routes/queue.tsx"],
  ])("passes the breakdown through from %s", (_label, path) => {
    const file = source(path);
    expect(file).toContain("QueueItemActionSheet");
    expect(file).toContain("rankBreakdown=");
    expect(file).toContain("configuredEnergyTarget=");
  });

  it.each([
    ["the mobile queue", "components/mobile/MobileQueueView.tsx"],
    ["the desktop queue", "components/review/ReviewQueueView.tsx"],
    ["the standalone queue route", "routes/queue.tsx"],
  ])("reads rankBreakdowns from the queue store in %s", (_label, path) => {
    // Either selector style counts — a single-field selector and a shallow object
    // are both valid. What must not happen is the surface reading the prop from
    // anywhere other than the store.
    const file = source(path);
    const reads = [
      "rankBreakdowns: state.rankBreakdowns",
      "s.rankBreakdowns",
      "s) => s.rankBreakdowns",
    ];
    expect(reads.some((pattern) => file.includes(pattern))).toBe(true);
  });

  it("reads the energy target from settings on every surface", () => {
    for (const path of [
      "components/mobile/MobileQueueView.tsx",
      "routes/queue.tsx",
    ]) {
      expect(source(path)).toContain("settings.daqe?.knobs.energyTarget");
    }
    // The desktop queue already reads the whole daqe settings object.
    expect(source("components/review/ReviewQueueView.tsx")).toContain(
      "daqeSettings.knobs.energyTarget",
    );
  });

  it("does not nest the breakdown inside the row button", () => {
    // A disclosure inside the row <button> would be interactive content nested in
    // interactive content, which breaks both semantics and touch handling.
    const mobile = source("components/mobile/MobileQueueView.tsx");
    const sheet = mobile.slice(mobile.indexOf("QueueRow"));
    expect(sheet).not.toContain("DaqeScoreBreakdown");
  });

  it("keeps the sheet's own title as the accessible name", () => {
    // The breakdown adds a heading inside the sheet; the dialog label must still
    // be the action title, or a screen reader announces "why is this here?" for
    // a sheet whose purpose is actions.
    expect(source(SHEET)).toContain('title={t("queue.itemActions")}');
  });
});

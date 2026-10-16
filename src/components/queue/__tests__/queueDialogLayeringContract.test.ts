import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layering contract for the New Queue journey (see
 * `openspec/changes/fix-session-customize-mobile-layering`).
 *
 * Both dialogs used to hand-roll a full-screen overlay with an ad-hoc z-index
 * (`z-50`, `z-[9999]`) while the mobile bottom navigation sits at `z-index:
 * 1000`. That painted the navigation over the dialog, so the dialog footer
 * landed beneath the toolbar and could not be tapped. The shared
 * `ResponsiveDialogSheet` owns the layering through the documented overlay
 * tokens, so the durable contract is: these dialogs obtain their layer from it
 * and never reintroduce a raw overlay root of their own.
 */
const root = resolve(import.meta.dirname, "../../../..");

const dialogs = [
  ["New Queue / Customize Session", "src/components/review/SessionCustomizeModal.tsx"],
  ["Manage Queues", "src/components/queue/ManageSavedQueuesModal.tsx"],
] as const;

describe("queue dialog layering contract", () => {
  for (const [name, file] of dialogs) {
    const source = () => readFileSync(resolve(root, file), "utf8");

    it(`${name} obtains its layer from the shared dialog`, () => {
      const text = source();
      expect(text).toContain('from "../adaptive/ResponsiveDialogSheet"');
      expect(text).toContain("<ResponsiveDialogSheet");
    });

    it(`${name} has no ad-hoc full-screen overlay root`, () => {
      const text = source();
      // Any className that opens a fixed overlay covering the viewport, and any
      // raw z-index utility. Both mean the dialog is fighting the shared layer.
      const classNameValues = Array.from(text.matchAll(/className="([^"]*)"/g), (m) => m[1]);
      const offenders = classNameValues.filter(
        (value) =>
          (value.includes("fixed") && value.includes("inset-0")) ||
          /\bz-(\[)?\d/.test(value),
      );
      expect(offenders).toEqual([]);
    });

    it(`${name} lets the shared sheet own the dialog role`, () => {
      expect(source()).not.toContain('role="dialog"');
    });
  }
});

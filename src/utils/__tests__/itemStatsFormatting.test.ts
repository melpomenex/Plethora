import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationCompact } from "../date";
import { formatMetric, hasValue, presentMetric } from "../itemStats";
import type { Metric } from "../../api/item-stats";

describe("formatDuration", () => {
  it("scales to its magnitude with explicit units", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(750)).toBe("12m 30s");
    expect(formatDuration(8040)).toBe("2h 14m");
  });

  it("never shows a raw second count", () => {
    // The spec's example: 8040 seconds must read as hours and minutes.
    expect(formatDuration(8040)).not.toContain("8040");
  });

  it("clamps values that cannot be rendered honestly", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
  });
});

describe("formatDurationCompact", () => {
  it("drops the seconds component so dense lists stay scannable", () => {
    expect(formatDurationCompact(45)).toBe("45s");
    expect(formatDurationCompact(750)).toBe("13m");
    expect(formatDurationCompact(8040)).toBe("2h 14m");
  });

  it("agrees with formatDuration above an hour", () => {
    for (const seconds of [3600, 8040, 36_000]) {
      expect(formatDurationCompact(seconds)).toBe(formatDuration(seconds));
    }
  });
});

describe("presentMetric", () => {
  it("renders a genuine zero as a value", () => {
    const metric: Metric<number> = { state: "value", value: 0 };
    expect(presentMetric(metric)).toEqual({ kind: "value", value: 0 });
    expect(hasValue(metric)).toBe(true);
  });

  it("renders an untracked metric as an explicit note, not a zero", () => {
    expect(presentMetric<number>({ state: "untracked" })).toEqual({ kind: "notRecorded" });
    expect(hasValue<number>({ state: "untracked" })).toBe(false);
  });

  it("omits a metric that does not apply to the item type", () => {
    expect(presentMetric<number>({ state: "notApplicable" })).toEqual({ kind: "omit" });
    expect(presentMetric<number>(null)).toEqual({ kind: "omit" });
    expect(presentMetric<number>(undefined)).toEqual({ kind: "omit" });
  });

  it("omits an unrecognised state rather than showing a blank placeholder", () => {
    const fromNewerBackend = { state: "somethingElse" } as unknown as Metric<number>;
    expect(presentMetric(fromNewerBackend)).toEqual({ kind: "omit" });
  });
});

describe("formatMetric", () => {
  const notRecorded = "Not recorded";

  it("formats a real value, including zero", () => {
    expect(formatMetric<number>({ state: "value", value: 8040 }, formatDuration, notRecorded)).toBe(
      "2h 14m",
    );
    expect(formatMetric<number>({ state: "value", value: 0 }, formatDuration, notRecorded)).toBe(
      "0s",
    );
  });

  it("returns the not-recorded label for an untracked metric", () => {
    expect(formatMetric<number>({ state: "untracked" }, formatDuration, notRecorded)).toBe(
      notRecorded,
    );
  });

  it("returns null for a metric the caller should omit", () => {
    expect(formatMetric<number>({ state: "notApplicable" }, formatDuration, notRecorded)).toBeNull();
  });
});

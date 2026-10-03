import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A reader who paid for a decision model must be able to find out whether it is
 * working, without opening settings and reasoning about which fallback applies.
 *
 * These assertions guard the two halves of that promise: that a probe exists and
 * is reachable from the picker, and that the *effective* state is stated where
 * the ranking is configured — because a configured-but-failing model is the one
 * state where nothing looks broken.
 */

const root = join(process.cwd(), "src");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const PICKER = "components/queue/DaqeDecisionModelSettings.tsx";
const PANEL = "components/settings/SmartQueuesSettings.tsx";

describe("the reader can test a credential", () => {
  it("offers a connection test in the picker", () => {
    const picker = source(PICKER);
    expect(picker).toContain("runProbe");
    expect(picker).toContain("probeDecisionModel");
    expect(picker).toContain('t("daqeProbe.test")');
  });

  it("reports the outcome rather than a bare pass/fail", () => {
    // "Reachable but answered wrong" and "not a decisions endpoint" are different
    // faults with different fixes, and a boolean would throw both away.
    const picker = source(PICKER);
    expect(picker).toContain("ProbeReport");
    expect(picker).toContain("resolvedModel");
    expect(picker).toContain("latencyMs");
    expect(picker).toContain("inputTokens");
  });

  it("surfaces the failure reason, translated", () => {
    const picker = source(PICKER);
    expect(picker).toContain("daqeProbe.reason.");
    for (const loc of ["en", "de", "es", "fr", "ja", "zh"]) {
      expect(source(`lib/i18n/locales/${loc}.ts`)).toContain('"daqeProbe.reason.unauthorized"');
    }
  });

  it("discards a previous result when the provider changes", () => {
    // A result describing the previous endpoint would be worse than none.
    expect(source(PICKER)).toContain("setProbeResult(null)");
  });

  it("says what the test costs, because it is not free", () => {
    expect(source(PICKER)).toContain('t("daqeProbe.billed"');
  });
});

describe("the effective state is stated, not assumed", () => {
  it("renders a status line in the ranking section", () => {
    const panel = source(PANEL);
    // Compare the JSX *usages*, not the imports: both names are imported at the
    // top of the file, so first-occurrence ordering says nothing about the layout.
    const statusUse = panel.indexOf("<DecisionModelStatusLine");
    const knobsUse = panel.indexOf("<DaqeKnobPanel");
    expect(statusUse).toBeGreaterThan(-1);
    expect(knobsUse).toBeGreaterThan(-1);
    // Above the knobs: a reader should not have to scroll past six sliders to
    // learn the model they paid for is not answering.
    expect(statusUse).toBeLessThan(knobsUse);
  });

  it("says degraded in words, not just a colour", () => {
    const line = source("components/queue/DecisionModelStatusLine.tsx");
    expect(line).toContain('t("daqeStatus.degraded")');
    // The degraded copy must name what is being used instead.
    for (const loc of ["en", "de", "es", "fr", "ja", "zh"]) {
      const text = source(`lib/i18n/locales/${loc}.ts`);
      const degraded = text.split('"daqeStatus.degraded":')[1]?.split("\n")[0] ?? "";
      expect(degraded.length).toBeGreaterThan(20);
    }
  });

  it("distinguishes untested from working", () => {
    const line = source("components/queue/DecisionModelStatusLine.tsx");
    expect(line).toContain('t("daqeStatus.untested")');
    expect(line).toContain('t("daqeStatus.working")');
    // And says ranking is off rather than implying the model is at fault.
    expect(line).toContain('t("daqeStatus.rankingOff")');
  });

  it("does not claim a model is working without a fresh result", () => {
    const probe = source("lib/daqe/decisionModelProbe.ts");
    // Thirty-minute expiry: a green tick outliving an outage is worse than
    // admitting ignorance.
    expect(probe).toContain("STALE_AFTER_MS");
    expect(probe).toContain('"untested"');
    // A warning is not a success: only `ok` maps to working.
    expect(probe).toContain("probeSucceeded");
    expect(probe).toMatch(/probeSucceeded\([^)]*\)\s*\?\s*"working"\s*:\s*"degraded"/);
  });
});

describe("the probe cannot be mistaken for the ranking call", () => {
  it("is separate from the ranking request builder", () => {
    const probe = source("lib/daqe/decisionModelProbe.ts");
    const systemOne = source("lib/daqe/systemOne.ts");
    // Two questions, not three: the probe must not be able to drift into
    // becoming a second, cheaper ranking path.
    expect(probe).toContain("PROBE_QUESTIONS");
    expect(probe).not.toContain("buildItemDecision");
    expect(systemOne).toContain("buildItemDecision");
  });

  it("reuses the ranking client's validator, so a probe cannot pass a bad request", () => {
    expect(source("lib/daqe/decisionModelProbe.ts")).toContain("callSystemOne");
  });
});

describe("the request goes through the backend", () => {
  it("routes the probe through Rust, because CORS does not apply there", () => {
    // A credentialed POST from the renderer triggers a preflight that
    // api.cloudflare.com does not answer, and WebKit reports that as
    // "Load failed" — indistinguishable from a dead host. Routing through Rust
    // removes the renderer from the request path.
    const api = source("api/ai.ts");
    expect(api).toContain('invokeCommand<DaqeHttpResponse>("daqe_decision_request"');
    expect(source("components/queue/DaqeDecisionModelSettings.tsx")).toContain(
      "probeSelectedModel",
    );
  });

  it("assembles every provider's endpoint in Rust, not in the frontend", () => {
    // The Clef case is the reason: Workers AI addresses a model in the path
    // (`/ai/run/@cf/cloudflare/clef`) while System One uses `/v1/systemone`, and
    // building the wrong one 404s while looking exactly like a bad account id.
    // Check the executable code, not the comments that explain why: the doc
    // block in this file names the wrong path deliberately, to describe the bug.
    const api = source("api/ai.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(api).not.toContain("api/cloudflare.com");
    expect(api).not.toContain("/v1/systemone");
  });

  it("maps provider ids to the backend's wire names", () => {
    const api = source("api/ai.ts");
    expect(api).toContain('case "openrouter-decisions":');
    // Nothing selected, or the AI spine, has no System One endpoint.
    expect(api).toContain("return null");
  });

  it("falls back to a direct call when there is no backend", () => {
    // A browser build has no Tauri host; reporting that as a connection failure
    // would be a lie about the credential.
    const picker = source("components/queue/DaqeDecisionModelSettings.tsx");
    expect(picker).toContain("probeDecisionModel");
  });
});

describe("clef's endpoint is not a system one path", () => {
  it("is asserted in Rust, where the URL is built", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "commands", "daqe_probe.rs"),
      "utf8",
    );
    // The regression that produced "could not reach the endpoint".
    expect(rust).toContain("/ai/run/@cf/cloudflare/clef");
    // And the body carries the bare name, not the path form.
    expect(rust).toContain("rsplit('/')");
  });
});

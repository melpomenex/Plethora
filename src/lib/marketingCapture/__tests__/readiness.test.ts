import { afterEach, describe, expect, it } from "vitest";
import { marketingReadinessIssue } from "../readiness";
import { resolveMarketingSceneApplication } from "../sceneApplicators";

function readyBody() {
  document.body.dataset.marketingFixtureCommitted = "true";
  document.body.dataset.marketingStateApplied = "true";
  document.body.dataset.marketingSurface = "library";
  document.body.innerHTML = "<main>Why highlighting feels like learning · Sleep is not downtime for memory</main>";
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("data-marketing-fixture-committed");
  document.body.removeAttribute("data-marketing-state-applied");
  document.body.removeAttribute("data-marketing-surface");
  document.body.removeAttribute("data-marketing-connections-ready");
});

describe("marketing capture readiness", () => {
  const application = resolveMarketingSceneApplication("library.ready");

  it("accepts a committed scene with all sentinels", () => {
    readyBody();
    expect(marketingReadinessIssue(application)).toBeNull();
  });

  it("rejects missing sentinels and placeholder text", () => {
    readyBody();
    document.body.textContent = "Why highlighting feels like learning";
    expect(marketingReadinessIssue(application)).toContain("missing sentinel");
    readyBody();
    document.body.append(" Loading...");
    expect(marketingReadinessIssue(application)).toContain("blocking placeholder");
  });

  it("requires the transaction and scene-state markers", () => {
    readyBody();
    document.body.dataset.marketingFixtureCommitted = "false";
    expect(marketingReadinessIssue(application)).toContain("not committed");
  });

  it("waits for the connection graph viewport to settle", () => {
    const connection = resolveMarketingSceneApplication("connections.context");
    document.body.dataset.marketingFixtureCommitted = "true";
    document.body.dataset.marketingStateApplied = "true";
    document.body.dataset.marketingSurface = "connections";
    document.body.textContent = "Recognition is cheap · Effort is a teaching signal";

    expect(marketingReadinessIssue(connection)).toContain("viewport is not settled");
    document.body.dataset.marketingConnectionsReady = "1";
    expect(marketingReadinessIssue(connection)).toBeNull();
  });
});

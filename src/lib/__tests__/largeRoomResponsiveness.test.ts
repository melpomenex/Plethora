import { describe, expect, it } from "vitest";
import { buildSyncFixture } from "../sync/syncFixtures";
import { ProgressiveSyncScheduler } from "../sync/progressiveScheduler";

describe("large-room responsiveness", () => {
  it("queues ten-year fixture work without synchronous replay", async () => {
    const fixture = buildSyncFixture("ten-year");
    const scheduler = new ProgressiveSyncScheduler({ inputPending: () => false, visible: () => true, maxItemsPerSlice: 4 });
    let processed = 0;
    for (const record of fixture.records.slice(0, 100)) {
      scheduler.enqueue({ id: `fixture:${record.id}`, lane: "P2", run: () => { processed += 1; } });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processed).toBeGreaterThan(0);
    scheduler.dispose();
  });
});

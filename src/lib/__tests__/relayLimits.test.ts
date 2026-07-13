import { describe, expect, it } from "vitest";
import { getRelayLimits } from "../sync/relayLimits";

describe("relay limits", () => {
  it("uses a bounded provider fallback when multiplexing is unavailable", () => {
    expect(getRelayLimits().maxConcurrentProviders).toBe(4);
    expect(getRelayLimits(["multiplexed-shards"]).multiplexed).toBe(true);
  });
});

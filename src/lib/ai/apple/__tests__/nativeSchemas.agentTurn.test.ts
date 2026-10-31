/**
 * Apple FM native schema decision (change 10.5): `agentTurn` is NOT added to
 * APPLE_FM_NATIVE_SCHEMAS because no bridge fixture wire test proves the
 * envelope round-trips on-device yet; strict-JSON remains the agent path on
 * Apple FM. This test locks the decision — it must flip deliberately when a
 * wire-verified fixture exists (design §13).
 */

import { describe, expect, it } from "vitest";
import { APPLE_FM_NATIVE_SCHEMAS, appleFmSupportsNativeSchema } from "../nativeSchemas";
import { AGENT_TURN_SCHEMA } from "../../schemas/agentTurn";

describe("Apple FM native agent-turn schema decision", () => {
  it("keeps agentTurn strict-JSON (declined until a wire fixture proves it)", () => {
    expect(APPLE_FM_NATIVE_SCHEMAS.has(AGENT_TURN_SCHEMA.nativeName)).toBe(false);
    expect(appleFmSupportsNativeSchema("agentTurn")).toBe(false);
  });

  it("reserves the native envelope name for a future wire-verified fixture", () => {
    expect(AGENT_TURN_SCHEMA.nativeName).toBe("agentTurn");
  });
});

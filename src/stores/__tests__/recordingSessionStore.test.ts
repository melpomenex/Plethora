import { beforeEach, describe, expect, it } from "vitest";
import {
  reduceRecordingState,
  useRecordingSessionStore,
} from "../recordingSessionStore";

describe("RecordingSessionStore & D3 lifecycle reducer", () => {
  beforeEach(() => {
    useRecordingSessionStore.getState().reset();
  });

  it("follows the valid D3 lifecycle state transitions", () => {
    let state = reduceRecordingState("idle", { type: "START" });
    expect(state).toBe("requesting-permission");

    state = reduceRecordingState(state, { type: "MIC_READY" });
    expect(state).toBe("recording");

    state = reduceRecordingState(state, { type: "PAUSE" });
    expect(state).toBe("paused");

    state = reduceRecordingState(state, { type: "RESUME" });
    expect(state).toBe("recording");

    state = reduceRecordingState(state, { type: "FINISH" });
    expect(state).toBe("finalizing");

    state = reduceRecordingState(state, { type: "SAVE_SUCCESS" });
    expect(state).toBe("saved");
  });

  it("handles permission denial and init failures", () => {
    let state = reduceRecordingState("idle", { type: "START" });
    expect(state).toBe("requesting-permission");

    state = reduceRecordingState(state, { type: "INIT_FAILED" });
    expect(state).toBe("failed");
  });

  it("handles interruptions and resumption with a new part", () => {
    let state = reduceRecordingState("recording", { type: "INTERRUPT" });
    expect(state).toBe("interrupted");

    state = reduceRecordingState(state, { type: "RESUME" });
    expect(state).toBe("recording");
  });

  it("handles finalize failure transitioning to recoverable", () => {
    let state = reduceRecordingState("recording", { type: "FINISH" });
    expect(state).toBe("finalizing");

    state = reduceRecordingState(state, { type: "SAVE_FAILED" });
    expect(state).toBe("recoverable");

    // Can continue recording from recoverable
    const continueState = reduceRecordingState(state, { type: "CONTINUE" });
    expect(continueState).toBe("recording");

    // Can save recovered recording
    const savedState = reduceRecordingState(state, { type: "SAVE_SUCCESS" });
    expect(savedState).toBe("saved");

    // Can explicitly discard from recoverable
    const discardedState = reduceRecordingState(state, { type: "DISCARD" });
    expect(discardedState).toBe("discarded");
  });

  it("rejects illegal transitions without corrupting state", () => {
    // Cannot pause while idle
    expect(reduceRecordingState("idle", { type: "PAUSE" })).toBe("idle");
    // Cannot finish while idle
    expect(reduceRecordingState("idle", { type: "FINISH" })).toBe("idle");
    // Cannot resume while recording
    expect(reduceRecordingState("recording", { type: "RESUME" })).toBe("recording");
    // Cannot discard while actively recording
    expect(reduceRecordingState("recording", { type: "DISCARD" })).toBe("recording");
  });

  it("tracks store state, health, and window minimization", () => {
    const store = useRecordingSessionStore.getState();
    store.setActiveSession("sess-1", "asset-1", "epoch-1");
    store.setHealth({ acknowledgedMs: 5000, pendingBytes: 1024 });
    store.setMinimized(true);

    const updated = useRecordingSessionStore.getState();
    expect(updated.activeSessionId).toBe("sess-1");
    expect(updated.activeAssetId).toBe("asset-1");
    expect(updated.writerEpoch).toBe("epoch-1");
    expect(updated.health.acknowledgedMs).toBe(5000);
    expect(updated.health.pendingBytes).toBe(1024);
    expect(updated.isMinimized).toBe(true);

    store.reset();
    const reset = useRecordingSessionStore.getState();
    expect(reset.state).toBe("idle");
    expect(reset.activeSessionId).toBe(null);
    expect(reset.isMinimized).toBe(false);
  });
});

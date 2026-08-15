/**
 * AI provenance TS wrapper (task 2.9): camelCase command field mapping and
 * the exact commands invoked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAiProvenance, recordAiProvenance } from "../ai-provenance";

const invokeCommand = vi.hoisted(() => vi.fn());

vi.mock("../../lib/tauri", () => ({
  invokeCommand: invokeCommand,
}));

describe("ai provenance api", () => {
  beforeEach(() => {
    invokeCommand.mockReset();
  });

  it("records provenance after a create with the camelCase payload", async () => {
    const record = { id: "prov-1", target_kind: "learning_item" };
    invokeCommand.mockResolvedValue(record);

    await recordAiProvenance({
      targetKind: "learning_item",
      targetId: "item-1",
      taskId: "learn-this",
      provider: "ondevice-nano",
      model: "gemini-nano",
      modelClass: "full",
      inputFingerprint: "fnv-123",
      metadata: { passage: "Entropy is a measure of microstates.", cardType: "definition" },
    });

    expect(invokeCommand).toHaveBeenCalledWith(
      "record_ai_provenance",
      expect.objectContaining({
        targetKind: "learning_item",
        targetId: "item-1",
        taskId: "learn-this",
        provider: "ondevice-nano",
        model: "gemini-nano",
        modelClass: "full",
        inputFingerprint: "fnv-123",
        metadataJson: { passage: "Entropy is a measure of microstates.", cardType: "definition" },
      })
    );
  });

  it("queries provenance for a target", async () => {
    const records = [{ id: "prov-1" }, { id: "prov-2" }];
    invokeCommand.mockResolvedValue(records);

    const result = await getAiProvenance("learning_item", "item-1");

    expect(result).toEqual(records);
    expect(invokeCommand).toHaveBeenCalledWith("get_ai_provenance", {
      targetKind: "learning_item",
      targetId: "item-1",
    });
  });
});

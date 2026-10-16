import { describe, expect, it, vi } from "vitest";
import { executeCommand } from "../executeCommand";
import { useToastStore } from "../../components/common/Toast";

describe("shared command execution", () => {
  it("dismisses before running and prevents repeated pending work", async () => {
    const order: string[] = [];
    let finish!: () => void;
    const action = vi.fn(() => { order.push("action"); return new Promise<void>((resolve) => { finish = resolve; }); });
    const command = { id: "pending", label: "Pending", action };
    const first = executeCommand(command, () => order.push("close"));
    await executeCommand(command);
    expect(order).toEqual(["close", "action"]);
    expect(action).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
  it.each([false, true])("reports synchronous and async failures (async=%s)", async (asyncFailure) => {
    const toast = vi.spyOn(useToastStore.getState(), "addToast");
    await executeCommand({ id: "failure", label: "Manage Queues", action: () => {
      if (asyncFailure) return Promise.reject(new Error("Storage failed"));
      throw new Error("Storage failed");
    } });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Manage Queues", message: expect.stringContaining("Storage failed") }));
    toast.mockRestore();
  });
});

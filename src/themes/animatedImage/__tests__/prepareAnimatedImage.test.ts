import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareAnimatedImageFile } from "../prepareAnimatedImage";

class FakeWorker {
  static latest: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posts: Array<{ message: { generation: number }; transfer: Transferable[] }> = [];

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(message: { generation: number }, transfer: Transferable[] = []): void {
    this.posts.push({ message, transfer });
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "error",
          generation: message.generation,
          code: "malformed-container",
          message: "Invalid GIF structure",
        },
      } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function installWorker(): void {
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  FakeWorker.latest = null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.latest = null;
});

describe("prepareAnimatedImageFile dispatch", () => {
  it("keeps ordinary non-GIF image inputs on the existing still path", async () => {
    installWorker();
    const file = new File(["PNG data"], "wallpaper.png", { type: "application/octet-stream" });
    await expect(prepareAnimatedImageFile(file, { tier: "desktop" })).resolves.toBeNull();
    expect(FakeWorker.latest).toBeNull();
  });

  it("dispatches by GIF signature even when MIME and extension say PNG", async () => {
    installWorker();
    const file = new File(["GIF89a"], "wallpaper.png", { type: "image/png" });
    await expect(prepareAnimatedImageFile(file, { tier: "desktop" })).rejects.toMatchObject({
      code: "malformed-container",
    });
    expect(FakeWorker.latest?.posts).toHaveLength(1);
    expect(FakeWorker.latest?.terminated).toBe(true);
  });

  it("rejects empty or signature-mismatched GIF-labeled files without creating a worker", async () => {
    installWorker();
    const empty = new File([], "empty.gif", { type: "image/gif" });
    await expect(prepareAnimatedImageFile(empty, { tier: "desktop" })).rejects.toMatchObject({ code: "empty-input" });
    const mislabeled = new File(["not a GIF"], "motion.gif", { type: "image/gif" });
    await expect(prepareAnimatedImageFile(mislabeled, { tier: "desktop" })).rejects.toMatchObject({ code: "invalid-signature" });
    expect(FakeWorker.latest).toBeNull();
  });

  it("reports a module-worker capability fallback when no Worker exists", async () => {
    vi.stubGlobal("Worker", undefined);
    const file = new File(["GIF89a"], "motion.bin", { type: "application/octet-stream" });
    await expect(prepareAnimatedImageFile(file, { tier: "desktop" })).rejects.toMatchObject({
      code: "worker-unavailable",
      capability: "module-worker",
    });
  });
});

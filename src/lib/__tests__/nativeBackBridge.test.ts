import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startNativeBackBridge,
  type NativeBackRequest,
  type NativeBackTransport,
} from "../nativeBackBridge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeTransport() {
  let deliver: ((request: NativeBackRequest) => void) | null = null;
  const order: string[] = [];
  const transport: NativeBackTransport = {
    listen: vi.fn(async (handler) => {
      order.push("listen");
      deliver = handler;
      return { unregister: vi.fn(async () => { order.push("unregister"); }) };
    }),
    attach: vi.fn(async () => {
      order.push("attach");
      return { protocolVersion: 1, epoch: "epoch-1" };
    }),
    claim: vi.fn(async () => ({ accepted: true, remainingMs: 1000, expiresAtEpochMs: Date.now() + 1000 })),
    acknowledge: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
  };
  return {
    transport,
    order,
    deliver: (request: NativeBackRequest) => deliver?.(request),
  };
}

const request: NativeBackRequest = {
  protocolVersion: 1,
  epoch: "epoch-1",
  sequence: 1,
  id: "back-1",
};

describe("nativeBackBridge", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("registers the listener before attach and dispatches each claimed id once", async () => {
    const { transport, order, deliver } = makeTransport();
    const dispatch = vi.fn(() => ({ kind: "consumed", outcome: "completed", transitionId: "back-1" }) as const);
    cleanups.push(startNativeBackBridge({ transport, dispatch }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    expect(order.slice(0, 2)).toEqual(["listen", "attach"]);

    deliver(request);
    deliver(request);
    await vi.waitFor(() => expect(transport.acknowledge).toHaveBeenCalledOnce());
    expect(dispatch).toHaveBeenCalledOnce();
    expect(transport.claim).toHaveBeenCalledOnce();
  });

  it("does not dispatch a claim that resolves after the page becomes hidden", async () => {
    const { transport, deliver } = makeTransport();
    const claim = deferred<{ accepted: boolean; remainingMs: number; expiresAtEpochMs: number }>();
    vi.mocked(transport.claim).mockReturnValueOnce(claim.promise);
    const dispatch = vi.fn(() => ({ kind: "root" }) as const);
    cleanups.push(startNativeBackBridge({ transport, dispatch, isVisible: () => document.visibilityState !== "hidden" }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    deliver(request);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    claim.resolve({ accepted: true, remainingMs: 1000, expiresAtEpochMs: Date.now() + 1000 });
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    expect(transport.acknowledge).not.toHaveBeenCalled();
  });

  it("keeps a claimed request from replaying when ACK delivery fails", async () => {
    const { transport, deliver } = makeTransport();
    vi.mocked(transport.acknowledge).mockRejectedValueOnce(new Error("lost ack"));
    const dispatch = vi.fn(() => ({ kind: "consumed", outcome: "pending" }) as const);
    cleanups.push(startNativeBackBridge({ transport, dispatch }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    deliver(request);
    await vi.waitFor(() => expect(transport.acknowledge).toHaveBeenCalledOnce());
    deliver(request);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(transport.claim).toHaveBeenCalledOnce();
  });
});

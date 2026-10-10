vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invoke: vi.fn(),
}));
import { invoke } from "@tauri-apps/api/core";
import { useTabsStore, createTabPane } from "../../stores/tabsStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startNativeBackBridge,
  productionNativeBackTransport,
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
    vi.useRealTimers();
    vi.restoreAllMocks();
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
  it("uses the Rust ACK args envelope on the production transport", async () => {
    await productionNativeBackTransport.acknowledge("epoch-1", "back-1", { kind: "root" });
    expect(invoke).toHaveBeenCalledWith("plugin:plethora-navigation|acknowledge", {
      args: { epoch: "epoch-1", id: "back-1", kind: "root" },
    });
  });

  it("unregisters late listener resolution after disposal", async () => {
    const { transport } = makeTransport();
    const pending = deferred<{ unregister(): Promise<void> }>();
    const unregister = vi.fn(async () => undefined);
    vi.mocked(transport.listen).mockReturnValue(pending.promise);
    const stop = startNativeBackBridge({ transport });
    stop();
    pending.resolve({ unregister });
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(transport.attach).not.toHaveBeenCalled();
  });

  it("recovers failed listener registration on a foreground signal", async () => {
    const { transport } = makeTransport();
    vi.mocked(transport.listen).mockRejectedValueOnce(new Error("plugin not ready"));
    cleanups.push(startNativeBackBridge({ transport }));
    await vi.waitFor(() => expect(transport.listen).toHaveBeenCalledOnce());
    await Promise.resolve();
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    expect(transport.listen).toHaveBeenCalledTimes(2);
  });

  it("replaces a session after pause and ignores old requests", async () => {
    const { transport, deliver } = makeTransport();
    const dispatch = vi.fn(() => ({ kind: "consumed", outcome: "completed" }) as const);
    vi.mocked(transport.attach).mockResolvedValueOnce({ protocolVersion: 1, epoch: "epoch-1" })
      .mockResolvedValueOnce({ protocolVersion: 1, epoch: "epoch-2" });
    cleanups.push(startNativeBackBridge({ transport, dispatch }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledTimes(2));
    deliver(request);
    deliver({ ...request, epoch: "epoch-2", id: "new-back" });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(transport.listen).toHaveBeenCalledOnce();
  });

  it("holds a new workspace activation until a rejected root ACK settles", async () => {
    const { transport, deliver } = makeTransport();
    const ack = deferred<{ accepted: boolean; backgrounded: boolean }>();
    vi.mocked(transport.acknowledge).mockReturnValueOnce(ack.promise);
    const pane = createTabPane(["dashboard", "queue"], "dashboard");
    useTabsStore.setState({ tabs: [], rootPane: pane, navigationPaneId: pane.id });
    cleanups.push(startNativeBackBridge({ transport, dispatch: () => ({ kind: "root" }) }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    deliver(request);
    await vi.waitFor(() => expect(transport.acknowledge).toHaveBeenCalledOnce());
    useTabsStore.getState().setActiveTab(pane.id, "queue");
    expect(useTabsStore.getState().findPaneById(pane.id)).toMatchObject({ activeTabId: "dashboard" });
    ack.resolve({ accepted: false, backgrounded: false });
    await vi.waitFor(() => expect(useTabsStore.getState().findPaneById(pane.id)).toMatchObject({ activeTabId: "queue" }));
  });

  it("consumes a throwing coordinator as unavailable instead of dropping its ACK", async () => {
    const { transport, deliver } = makeTransport();
    cleanups.push(startNativeBackBridge({ transport, dispatch: () => { throw new Error("broken context"); } }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    deliver(request);
    await vi.waitFor(() => expect(transport.acknowledge).toHaveBeenCalledWith("epoch-1", "back-1", { kind: "unavailable" }));
  });

  it("bounds a hung root ACK and never applies its eventual late result", async () => {
    const { transport, deliver } = makeTransport();
    const ack = deferred<{ accepted: boolean; backgrounded: boolean }>();
    vi.mocked(transport.acknowledge).mockReturnValueOnce(ack.promise);
    const pane = createTabPane(["dashboard", "queue"], "dashboard");
    useTabsStore.setState({ tabs: [], rootPane: pane, navigationPaneId: pane.id });
    cleanups.push(startNativeBackBridge({ transport, dispatch: () => ({ kind: "root" }) }));
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    deliver(request);
    await vi.advanceTimersByTimeAsync(0);
    useTabsStore.getState().setActiveTab(pane.id, "queue");
    expect(useTabsStore.getState().findPaneById(pane.id)).toMatchObject({ activeTabId: "dashboard" });
    await vi.advanceTimersByTimeAsync(1001);
    expect(useTabsStore.getState().findPaneById(pane.id)).toMatchObject({ activeTabId: "queue" });
    ack.resolve({ accepted: true, backgrounded: true });
    await vi.advanceTimersByTimeAsync(0);
    useTabsStore.getState().setActiveTab(pane.id, "dashboard");
    expect(useTabsStore.getState().findPaneById(pane.id)).toMatchObject({ activeTabId: "dashboard" });
  });

});

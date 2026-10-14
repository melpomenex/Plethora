import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activity: vi.fn(), saves: vi.fn(), listen: vi.fn(), stop: vi.fn(), handler: undefined as (() => void) | undefined }));
vi.mock("../../api/capture-activity", () => ({ getCaptureActivity: mocks.activity, getBrowserCaptureDocuments: mocks.saves }));
vi.mock("../../lib/tauri", () => ({ isTauri: () => true, listen: mocks.listen }));
import { useCaptureActivity } from "../useCaptureActivity";

const activity = { windowDays: 30, perDay: [], bySource: [], needsAttention: 0 };
const saves = { items: [], limit: 6, offset: 0, totalCount: 0 };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activity.mockResolvedValue(activity); mocks.saves.mockResolvedValue(saves);
  mocks.listen.mockImplementation((_event, handler) => { mocks.handler = handler; return Promise.resolve(mocks.stop); });
});
afterEach(() => vi.useRealTimers());

describe("capture refresh lifecycle", () => {
  it("loads independently and retains saved content on a later failure", async () => {
    mocks.activity.mockRejectedValue(new Error("analytics unavailable"));
    const { result } = renderHook(() => useCaptureActivity(true));
    await waitFor(() => expect(result.current.browserSaves.data).toEqual(saves));
    expect(result.current.activity.error).toBe("analytics unavailable");
    mocks.saves.mockRejectedValue(new Error("offline"));
    await act(async () => { await result.current.browserSaves.reload(); });
    expect(result.current.browserSaves.data).toEqual(saves);
    expect(result.current.browserSaves.error).toBe("offline");
  });

  it("coalesces active saves and defers inactive work to activation", async () => {
    const { result, rerender } = renderHook(({ active }) => useCaptureActivity(active), { initialProps: { active: false } });
    expect(mocks.saves).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(result.current.browserSaves.data).toEqual(saves));
    vi.useFakeTimers();
    act(() => { mocks.handler?.(); mocks.handler?.(); mocks.handler?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(mocks.saves).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.saves).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    act(() => mocks.handler?.());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.saves).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("ignores obsolete responses after a newer refresh", async () => {
    const pending = deferred<typeof saves>();
    mocks.saves.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useCaptureActivity(true));
    const newer = { ...saves, totalCount: 12 };
    mocks.saves.mockResolvedValue(newer);
    await act(async () => { await result.current.browserSaves.reload(); });
    await act(async () => { pending.resolve(saves); });
    expect(result.current.browserSaves.data).toEqual(newer);
  });

  it("disposes a listener whose registration finishes after unmount", async () => {
    const pending = deferred<() => void>();
    mocks.listen.mockReturnValueOnce(pending.promise);
    const { unmount } = renderHook(() => useCaptureActivity(true));
    unmount();
    await act(async () => { pending.resolve(mocks.stop); });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});

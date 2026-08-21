/**
 * Follow-behavior tests for useSpokenWordFollow: normal advance, deliberate
 * user scroll pauses follow (scrollTo stops), Re-center resumes, programmatic
 * scrolls are not misread as user intent, reduced motion scrolls instantly,
 * and follow stays suspended while inactive.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpokenWordFollow } from "../useSpokenWordFollow";
import type { UseSpokenWordFollowOptions } from "../useSpokenWordFollow";

function makeScrollContainer(): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-document-scroll-container", "true");
  // jsdom has no layout; spy scrollTo and define the layout getters directly.
  container.scrollTo = vi.fn();
  Object.defineProperty(container, "scrollTop", { value: 0, writable: true, configurable: true });
  Object.defineProperty(container, "scrollHeight", { value: 3000, writable: true, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, writable: true, configurable: true });
  document.body.appendChild(container);
  return container;
}

function setScrollTop(el: HTMLElement, value: number) {
  Object.defineProperty(el, "scrollTop", { value, writable: true, configurable: true });
}

function makeSpan(container: HTMLElement): HTMLElement {
  const span = document.createElement("span");
  span.className = "tts-word-highlight";
  container.appendChild(span);
  return span;
}

describe("useSpokenWordFollow", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    container = makeScrollContainer();
    // Lay out the span rect deterministically below the comfort band.
    container.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, left: 0, right: 800, height: 600, width: 800 } as DOMRect);
    Element.prototype.getBoundingClientRect = () =>
      ({ top: 500, bottom: 520, left: 0, right: 40, height: 20, width: 40 } as DOMRect);
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    vi.restoreAllMocks();
  });

  it("follows the spoken word with debounced scrolling", async () => {
    makeSpan(container);
    const { result } = renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    expect(result.current.pausedByUser).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(container.scrollTo).toHaveBeenCalled();
    const call = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe("smooth");
    expect(call.top).toBeGreaterThan(0);
  });

  it("deliberate user scroll pauses following while playback continues", async () => {
    makeSpan(container);
    const { result } = renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();

    // Let the programmatic grace window elapse so the next scroll is
    // attributable to the user.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Real user input + a scroll away from the programmatic target.
    container.dispatchEvent(new Event("wheel", { bubbles: false }));
    setScrollTop(container, 777);
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.pausedByUser).toBe(true);

    // Following stops: new words do not scroll.
    act(() => {
      vi.advanceTimersByTimeAsync(400);
    });
    setScrollTop(container, 777); // still away from any target
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it("Re-center restores follow and scrolls back to the word", async () => {
    makeSpan(container);
    const { result } = renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    container.dispatchEvent(new Event("wheel"));
    setScrollTop(container, 900);
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.pausedByUser).toBe(true);

    (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();
    act(() => {
      result.current.reCenter();
    });
    expect(result.current.pausedByUser).toBe(false);
    expect(container.scrollTo).toHaveBeenCalled();
  });

  it("programmatic scroll arrival is not mistaken for user intent", async () => {
    makeSpan(container);
    const { result } = renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const call = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.at(-1)[0];
    // The animation arrives at its clamped target (scrollHeight - clientHeight = 2400
    // vs computed target ~350 → clamped... target itself is within range).
    setScrollTop(container, Math.round(call.top));
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.pausedByUser).toBe(false);
  });

  it("reduced motion scrolls instantly", async () => {
    makeSpan(container);
    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        reducedMotion: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const call = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe("auto");
  });

  it("no follow work while inactive", async () => {
    makeSpan(container);
    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: false,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
    // Even a real user scroll does not set a pause while inactive.
    container.dispatchEvent(new Event("wheel"));
    setScrollTop(container, 555);
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it("compact (mobile) mode pins the spoken word at the compact comfort offset", async () => {
    makeSpan(container);
    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        compact: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const call = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.behavior).toBe("smooth");
    // relativeTop 500 − clientHeight 600 × 0.18 + spanHeight 20 / 2 = 402.
    expect(call.top).toBeCloseTo(500 - 600 * 0.18 + 10);
  });

  it("follows inside an EPUB viewer container (data-epub-viewer)", async () => {
    const epub = document.createElement("div");
    epub.setAttribute("data-epub-viewer", "true");
    epub.scrollTo = vi.fn();
    Object.defineProperty(epub, "scrollTop", { value: 0, writable: true, configurable: true });
    Object.defineProperty(epub, "scrollHeight", { value: 3000, writable: true, configurable: true });
    Object.defineProperty(epub, "clientHeight", { value: 600, writable: true, configurable: true });
    epub.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, left: 0, right: 800, height: 600, width: 800 } as DOMRect);
    document.body.appendChild(epub);
    // The active span may live nested deep inside the EPUB body.
    const body = document.createElement("div");
    const span = document.createElement("span");
    span.className = "tts-word-highlight";
    body.appendChild(span);
    epub.appendChild(body);

    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [epub],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(epub.scrollTo).toHaveBeenCalled();
    const call = (epub.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.top).toBeGreaterThan(0);
    epub.remove();
  });

  it("follows in a PDF/markdown document scroll container when the span is nested", async () => {
    const wrapper = document.createElement("div");
    const span = document.createElement("span");
    span.className = "tts-word-highlight";
    wrapper.appendChild(span);
    container.appendChild(wrapper);

    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // The ancestor traversal finds the data-document-scroll-container and
    // scrolls it (never a throw, never a stray element).
    expect(container.scrollTo).toHaveBeenCalled();
    const call = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.top).toBeGreaterThan(0);
  });

  // Boundary-transition regression tests: when narration crosses the initial
  // viewport boundary, follow must stay debounced and must never co-issue
  // duplicate scroll commands for a single transition.
  it("does not scroll before the debounce window elapses", async () => {
    makeSpan(container);
    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // < FOLLOW_DEBOUNCE_MS
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // past 150ms
    });
    expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("coalesces rapid boundary-crossing word transitions into one scroll per settle", async () => {
    makeSpan(container);
    const base: UseSpokenWordFollowOptions = {
      enabled: true,
      active: true,
      wordKey: "0:1",
      containers: [container],
    };
    const { rerender } = renderHook((p: UseSpokenWordFollowOptions) => useSpokenWordFollow(p), {
      initialProps: base,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    // Three word transitions inside the debounce window collapse to one.
    await act(async () => {
      rerender({ ...base, wordKey: "0:2" });
      await vi.advanceTimersByTimeAsync(40);
      rerender({ ...base, wordKey: "0:3" });
      await vi.advanceTimersByTimeAsync(40);
      rerender({ ...base, wordKey: "0:4" });
      await vi.advanceTimersByTimeAsync(40);
    });
    expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // Exactly one additional command for the whole rapid burst — no duplicates.
    expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("safely no-ops when the container unmounts during the debounce window", async () => {
    makeSpan(container);
    const base: UseSpokenWordFollowOptions = {
      enabled: true,
      active: true,
      wordKey: "0:1",
      containers: [container],
    };
    const { rerender } = renderHook((p: UseSpokenWordFollowOptions) => useSpokenWordFollow(p), {
      initialProps: base,
    });
    rerender({ ...base, wordKey: "0:2" });

    container.remove();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it("aborts follow when the container has zero height (hidden/backgrounded view)", async () => {
    makeSpan(container);
    Object.defineProperty(container, "clientHeight", {
      value: 0,
      writable: true,
      configurable: true,
    });
    renderHook(() =>
      useSpokenWordFollow({
        enabled: true,
        active: true,
        wordKey: "0:1",
        containers: [container],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it("clears pending debounce and programmatic timers when active becomes false", async () => {
    makeSpan(container);
    const base: UseSpokenWordFollowOptions = {
      enabled: true,
      active: true,
      wordKey: "0:1",
      containers: [container],
    };
    const { rerender } = renderHook((p: UseSpokenWordFollowOptions) => useSpokenWordFollow(p), {
      initialProps: base,
    });
    rerender({ ...base, wordKey: "0:2" }); // debounce scheduled
    rerender({ ...base, active: false }); // playback stops mid-window

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});

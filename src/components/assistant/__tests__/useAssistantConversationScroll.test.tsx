import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAssistantConversationScroll } from "../useAssistantConversationScroll";

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  callback: ResizeCallback;
  observed: Element[] = [];

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve(element: Element) {
    this.observed = this.observed.filter((el) => el !== element);
  }

  disconnect() {
    this.observed = [];
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("useAssistantConversationScroll", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    sessionStorage.clear();
    ControllableResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", ControllableResizeObserver);
  });

  afterEach(() => {
    if (originalResizeObserver) {
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it("isolates scroll position by conversationId across switches", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(div, "clientHeight", { value: 300, configurable: true });
    div.scrollTop = 0;
    const ref = { current: div };

    const messagesA = [{ id: "msg-a-1" }, { id: "msg-a-2" }];
    const messagesB = [{ id: "msg-b-1" }, { id: "msg-b-2" }];

    // Render for conversation A
    const { rerender, result } = renderHook(
      ({ convId, msgs }) =>
        useAssistantConversationScroll(ref, "assistant-scroll-base", true, msgs, convId),
      {
        initialProps: { convId: "conv-A", msgs: messagesA },
      }
    );

    // User scrolls conversation A to offset 400
    div.scrollTop = 400;
    div.dispatchEvent(new Event("wheel"));
    act(() => {
      result.current.onScroll();
    });

    // Switch to conversation B
    rerender({ convId: "conv-B", msgs: messagesB });

    // In conversation B, user scrolls conversation B to 200
    div.scrollTop = 200;
    div.dispatchEvent(new Event("wheel"));
    act(() => {
      result.current.onScroll();
    });

    // Switch back to conversation A
    rerender({ convId: "conv-A", msgs: messagesA });

    // Conversation A's scroll position (400) should be restored
    expect(div.scrollTop).toBe(400);

    // Switch back to conversation B
    rerender({ convId: "conv-B", msgs: messagesB });

    // Conversation B's scroll position (200) should be restored
    expect(div.scrollTop).toBe(200);
  });

  it("preserves bottom follow across periodic resize observer callbacks with transient zero-height collapses", () => {
    const div = document.createElement("div");
    let scrollHeight = 1000;
    let clientHeight = 300;
    Object.defineProperty(div, "scrollHeight", { get: () => scrollHeight, configurable: true });
    Object.defineProperty(div, "clientHeight", { get: () => clientHeight, configurable: true });
    div.scrollTop = 700;
    const ref = { current: div };

    const messages = [{ id: "msg-1" }, { id: "msg-2" }, { id: "msg-3" }];

    const { result } = renderHook(() =>
      useAssistantConversationScroll(ref, "scroll-follow-test", true, messages, "conv-follow")
    );

    // User is at bottom (follow: true)
    div.scrollTop = 700;
    act(() => {
      result.current.onScroll();
    });
    expect(result.current.showLatest).toBe(false);

    // Simulate transient collapse during background periodic update (e.g. 10s idle check)
    // Container height collapses temporarily before content renders
    scrollHeight = 0;
    clientHeight = 0;
    const observer = ControllableResizeObserver.instances[0];
    expect(observer).toBeDefined();

    act(() => {
      observer.trigger();
    });

    // restorePosition should NOT have set scrollTop = 0 because scrollHeight <= clientHeight
    expect(div.scrollTop).toBe(700);

    // If browser fired a scroll event with scrollTop = 0 during layout collapse without user interaction
    div.scrollTop = 0;
    scrollHeight = 1000;
    clientHeight = 300;

    act(() => {
      result.current.onScroll();
    });

    // The guard detects involuntary zero-scroll while follow: true and re-anchors to scrollHeight
    expect(div.scrollTop).toBe(1000);
    expect(result.current.showLatest).toBe(false);

    // On subsequent periodic resize triggers, it remains firmly at bottom
    act(() => {
      observer.trigger();
    });
    expect(div.scrollTop).toBe(1000);
    expect(result.current.showLatest).toBe(false);
  });

  it("ensures intentional user scroll to top is still captured correctly when scrollHeight > clientHeight", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(div, "clientHeight", { value: 300, configurable: true });
    div.scrollTop = 700;
    const ref = { current: div };

    const messages = [{ id: "msg-1" }, { id: "msg-2" }];

    const { result } = renderHook(() =>
      useAssistantConversationScroll(ref, "scroll-user-top-test", true, messages, "conv-user-top")
    );

    // Initially at bottom
    act(() => {
      result.current.onScroll();
    });
    expect(result.current.showLatest).toBe(false);

    // User intentionally scrolls to top with wheel event
    div.dispatchEvent(new Event("wheel"));
    div.scrollTop = 0;

    act(() => {
      result.current.onScroll();
    });

    // User-initiated scroll to top is captured, follow: false, showLatest is true
    expect(result.current.showLatest).toBe(true);

    // Periodic resize observer callback retains user's top position (0) without auto-jumping to bottom
    const observer = ControllableResizeObserver.instances[0];
    act(() => {
      observer.trigger();
    });
    expect(div.scrollTop).toBe(0);
    expect(result.current.showLatest).toBe(true);
  });

  it("preserves intermediate anchor positions across mock resize events without collapsing to top", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(div, "clientHeight", { value: 400, configurable: true });
    div.scrollTop = 350;
    const ref = { current: div };

    // Setup child elements with data-assistant-message-id
    const msg1 = document.createElement("div");
    msg1.dataset.assistantMessageId = "msg-1";
    const msg2 = document.createElement("div");
    msg2.dataset.assistantMessageId = "msg-2";
    div.appendChild(msg1);
    div.appendChild(msg2);

    div.getBoundingClientRect = () => ({
      top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON: () => {},
    });
    msg1.getBoundingClientRect = () => ({
      top: 50, bottom: 150, left: 0, right: 300, width: 300, height: 100, x: 0, y: 50, toJSON: () => {},
    });
    msg2.getBoundingClientRect = () => ({
      top: 150, bottom: 250, left: 0, right: 300, width: 300, height: 100, x: 0, y: 150, toJSON: () => {},
    });

    const messages = [{ id: "msg-1" }, { id: "msg-2" }];

    const { result } = renderHook(() =>
      useAssistantConversationScroll(ref, "scroll-anchor-test", true, messages, "conv-anchor")
    );

    // User scrolled to 350
    div.dispatchEvent(new Event("wheel"));
    div.scrollTop = 350;
    act(() => {
      result.current.onScroll();
    });

    // Simulate resize event where bounding rects are temporarily 0 (unmeasured)
    msg1.getBoundingClientRect = () => ({
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {},
    });
    div.getBoundingClientRect = () => ({
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {},
    });

    const observer = ControllableResizeObserver.instances[0];
    act(() => {
      observer.trigger();
    });

    // Should fall back to position.top (350) instead of computing invalid delta to 0
    expect(div.scrollTop).toBe(350);
  });

  it("does not lose non-follow position across temporary layout collapse with browser-like scrollTop clamping and delayed onScroll", () => {
    vi.useFakeTimers();
    const div = document.createElement("div");
    let currentScrollHeight = 1200;
    let currentClientHeight = 300;
    let internalScrollTop = 0;

    Object.defineProperty(div, "scrollHeight", { get: () => currentScrollHeight, configurable: true });
    Object.defineProperty(div, "clientHeight", { get: () => currentClientHeight, configurable: true });
    Object.defineProperty(div, "scrollTop", {
      get: () => internalScrollTop,
      set: (value: number) => {
        const maxScroll = Math.max(0, currentScrollHeight - currentClientHeight);
        internalScrollTop = Math.max(0, Math.min(value, maxScroll));
      },
      configurable: true,
    });

    const ref = { current: div };
    const messages = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const { result, rerender } = renderHook(
      ({ msgs }) => useAssistantConversationScroll(ref, "scroll-collapse-nonfollow", true, msgs, "conv-collapse-nonfollow"),
      { initialProps: { msgs: messages } },
    );

    // User scrolls away from bottom to 350
    div.dispatchEvent(new Event("wheel"));
    div.scrollTop = 350;
    act(() => {
      result.current.onScroll();
    });
    expect(div.scrollTop).toBe(350);
    expect(result.current.showLatest).toBe(true);

    // Wait beyond the interaction grace window, as during background EPUB reading
    act(() => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();

    // Simulate temporary layout collapse (e.g. display: none / height: 0 flex collapse)
    currentScrollHeight = 0;
    currentClientHeight = 0;
    internalScrollTop = 0; // Browser natively clamps scrollTop to 0 when collapsed

    // Layout observer + collapse-time onScroll run during the transient collapse
    const observer = ControllableResizeObserver.instances[0];
    act(() => {
      observer.trigger();
    });
    act(() => {
      // Browser dispatches scroll event while still collapsed -> clears expectedScroll
      result.current.onScroll();
    });

    // Layout recovers to scrollable dimensions; delayed collapse scroll event delivers after expand
    currentScrollHeight = 1200;
    currentClientHeight = 300;
    act(() => {
      result.current.onScroll();
    });
    rerender({ msgs: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });
    act(() => {
      ControllableResizeObserver.instances[ControllableResizeObserver.instances.length - 1].trigger();
    });

    expect(div.scrollTop).toBe(350);
    expect(result.current.showLatest).toBe(true);
  });

  it("resets interaction state cleanly when messages change within interaction window", () => {
    vi.useFakeTimers();
    const div = document.createElement("div");
    let internalScrollTop = 700;
    Object.defineProperty(div, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(div, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(div, "scrollTop", {
      get: () => internalScrollTop,
      set: (value: number) => {
        internalScrollTop = Math.max(0, Math.min(value, 700));
      },
      configurable: true,
    });
    const ref = { current: div };
    const { result, rerender } = renderHook(
      ({ msgs }) => useAssistantConversationScroll(ref, "scroll-timer-cleanup", true, msgs, "conv-timer-cleanup"),
      { initialProps: { msgs: [{ id: "m1" }, { id: "m2" }] } },
    );

    // User wheel interaction happens right before a messages update
    div.dispatchEvent(new Event("wheel"));
    div.scrollTop = 300;
    act(() => {
      result.current.onScroll();
    });

    // Trigger messages reference change while 250ms interaction timer is still pending
    rerender({ msgs: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });

    // Advance well past 250ms; interaction flag must NOT stay stuck true
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    // Now an involuntary reset to scrollTop = 0 without user interaction must not overwrite saved position
    div.scrollTop = 0;
    act(() => {
      result.current.onScroll();
    });

    expect(div.scrollTop).toBe(300);
    expect(result.current.showLatest).toBe(true);
  });

  it("ignores programmatic scroll events after restoration and preserves manual position across 30s of periodic background updates", () => {
    vi.useFakeTimers();
    try {
      const div = document.createElement("div");
      let currentScrollHeight = 1600;
      let currentClientHeight = 350;
      let internalScrollTop = 0;

      const msg0 = document.createElement("div");
      msg0.dataset.assistantMessageId = "m0";
      const msg1 = document.createElement("div");
      msg1.dataset.assistantMessageId = "m1";
      div.appendChild(msg0);
      div.appendChild(msg1);

      const zeroRect = {
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {},
      };
      div.getBoundingClientRect = () => (currentClientHeight === 0 ? zeroRect : {
        top: 0, bottom: currentClientHeight, left: 0, right: 300, width: 300, height: currentClientHeight, x: 0, y: 0, toJSON: () => {},
      });
      msg0.getBoundingClientRect = () => (currentClientHeight === 0 ? zeroRect : {
        top: -internalScrollTop, bottom: 430 - internalScrollTop, left: 0, right: 300, width: 300, height: 430, x: 0, y: -internalScrollTop, toJSON: () => {},
      });
      msg1.getBoundingClientRect = () => {
        if (currentClientHeight === 0) return zeroRect;
        const top = 440 - internalScrollTop;
        return {
          top, bottom: top + 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: top, toJSON: () => {},
        };
      };

      Object.defineProperty(div, "scrollHeight", { get: () => currentScrollHeight, configurable: true });
      Object.defineProperty(div, "clientHeight", { get: () => currentClientHeight, configurable: true });
      Object.defineProperty(div, "scrollTop", {
        get: () => internalScrollTop,
        set: (value: number) => {
          const maxScroll = Math.max(0, currentScrollHeight - currentClientHeight);
          internalScrollTop = Math.max(0, Math.min(value, maxScroll));
        },
        configurable: true,
      });

      const ref = { current: div };
      let currentMessages = [{ id: "m0" }, { id: "m1" }];
      const { result, rerender } = renderHook(
        ({ msgs }) => useAssistantConversationScroll(ref, "scroll-30s-stability", true, msgs, "conv-30s"),
        { initialProps: { msgs: currentMessages } },
      );

      // User manually scrolls to m1 with offset 20
      div.dispatchEvent(new Event("wheel"));
      div.scrollTop = 420;
      act(() => {
        result.current.onScroll();
      });
      expect(div.scrollTop).toBe(420);
      expect(result.current.showLatest).toBe(true);

      // Clear interaction grace window
      act(() => {
        vi.advanceTimersByTime(400);
      });

      const observer = ControllableResizeObserver.instances[0];

      // Simulate 30 seconds of periodic background updates (EPUB reading ticks, ResizeObserver,
      // new Assistant messages appended below, and transient collapses).
      for (let second = 1; second <= 30; second++) {
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        if (second % 7 === 0) {
          // Transient collapse and recovery
          currentScrollHeight = 0;
          currentClientHeight = 0;
          internalScrollTop = 0;
          act(() => {
            observer.trigger();
          });
          currentScrollHeight = 1600 + second * 20;
          currentClientHeight = 350;
          act(() => {
            observer.trigger();
          });
          // Delayed programmatic scroll event delivered right after restoration
          act(() => {
            result.current.onScroll();
          });
        } else {
          // Periodic background rerenders and ResizeObserver ticks during EPUB layout updates
          currentScrollHeight = 1600 + second * 20;
          currentMessages = second % 10 === 0
            ? [...currentMessages, { id: `m-new-${second}` }]
            : [...currentMessages];
          rerender({ msgs: currentMessages });
          act(() => {
            observer.trigger();
          });
          // Programmatic restore scroll event must not corrupt saved anchor or position
          act(() => {
            result.current.onScroll();
          });
        }

        expect(div.scrollTop).toBe(420);
        expect(result.current.showLatest).toBe(true);
      }

      // Clicking "Latest message" returns to bottom follow mode and tracks subsequent messages
      act(() => {
        result.current.showNewest();
      });
      expect(result.current.showLatest).toBe(false);
      expect(div.scrollTop).toBe(currentScrollHeight - currentClientHeight);

      currentScrollHeight += 240;
      rerender({ msgs: [...currentMessages, { id: "m-final" }] });
      expect(div.scrollTop).toBe(currentScrollHeight - currentClientHeight);
      expect(result.current.showLatest).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects slow scrollbar pointer drag to top beyond 250ms while preserving bottom follow otherwise", () => {
    vi.useFakeTimers();
    try {
      const div = document.createElement("div");
      let internalScrollTop = 700;
      Object.defineProperty(div, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(div, "clientHeight", { value: 300, configurable: true });
      Object.defineProperty(div, "scrollTop", {
        get: () => internalScrollTop,
        set: (value: number) => {
          internalScrollTop = Math.max(0, Math.min(value, 700));
        },
        configurable: true,
      });
      const ref = { current: div };
      const { result } = renderHook(() =>
        useAssistantConversationScroll(ref, "scroll-slow-drag-top", true, [{ id: "m1" }, { id: "m2" }], "conv-slow-drag"),
      );

      // Start pointer drag and hold for 600ms (> 250ms grace timeout) before reaching top
      div.dispatchEvent(new Event("pointerdown"));
      act(() => {
        vi.advanceTimersByTime(600);
      });
      div.scrollTop = 0;
      act(() => {
        result.current.onScroll();
      });
      window.dispatchEvent(new Event("pointerup"));

      expect(div.scrollTop).toBe(0);
      expect(result.current.showLatest).toBe(true);

      // Wait past grace window and fire ResizeObserver: intentional top position must hold
      act(() => {
        vi.advanceTimersByTime(400);
      });
      act(() => {
        ControllableResizeObserver.instances[0].trigger();
      });
      expect(div.scrollTop).toBe(0);
      expect(result.current.showLatest).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

import React, { useRef } from "react";
import { describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { useAssistantConversationScroll } from "../useAssistantConversationScroll";

describe("useAssistantConversationScroll", () => {
  it("isolates scroll position by conversationId across switches", () => {
    sessionStorage.clear();
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
    act(() => {
      result.current.onScroll();
    });

    // Switch to conversation B
    rerender({ convId: "conv-B", msgs: messagesB });

    // In conversation B, it initializes with follow: true (or top: 0 / scrollHeight)
    // Now user scrolls conversation B to 200
    div.scrollTop = 200;
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
});

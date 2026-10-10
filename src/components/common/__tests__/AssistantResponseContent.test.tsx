import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantResponseContent } from "../AssistantResponseContent";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AssistantResponseContent", () => {
  it("keeps thinking collapsed by default and separates it from the answer", () => {
    const { container } = render(
      <AssistantResponseContent content="<think>Reasoning text</think>Final answer" />,
    );
    const disclosure = container.querySelector("details");

    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    expect(screen.getByText("assistant.modelThinking")).toBeTruthy();
    expect(screen.getByText("Final answer")).toBeTruthy();
    fireEvent.click(disclosure!.querySelector("summary")!);
    expect(disclosure?.open).toBe(true);
    expect(screen.getByText("Reasoning text")).toBeTruthy();
    expect(container.textContent).not.toContain("<think>");
  });

  it("announces running and interrupted states without opening the disclosure", () => {
    const { rerender } = render(
      <AssistantResponseContent content="<think>Some reasoning" status="running" />,
    );
    expect(screen.getByText("assistant.thinkingInProgress")).toBeTruthy();
    rerender(
      <AssistantResponseContent content="<think>Some reasoning" status="interrupted" />,
    );
    expect(screen.getByText("assistant.thinkingInterrupted")).toBeTruthy();
  });
});

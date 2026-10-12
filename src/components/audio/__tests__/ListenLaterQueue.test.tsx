import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ListenLaterQueue } from "../ListenLaterQueue";
import * as orchestrator from "../../../lib/feedback/orchestrator";

vi.mock("../../../stores/listenLaterStore", () => ({
  useListenLaterStore: (selector: (state: any) => any) =>
    selector({
      queue: [],
      currentIndex: 0,
      schedulerMode: "lazy",
      setSchedulerMode: vi.fn(),
      removeItem: vi.fn(),
      reorderQueue: vi.fn(),
      clearQueue: vi.fn(),
      ensureItemSynthesized: vi.fn(),
    }),
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: (selector: (state: any) => any) =>
    selector({
      documents: [],
    }),
}));

vi.mock("../../../stores/tabsStore", () => ({
  useTabsStore: (selector: (state: any) => any) =>
    selector({
      addTab: vi.fn(),
    }),
}));

describe("ListenLaterQueue", () => {
  it("emits queue.closed tactile click feedback when close button is pressed", () => {
    const spy = vi.spyOn(orchestrator, "emitUserInteraction");
    const onClose = vi.fn();
    render(<ListenLaterQueue isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByLabelText("Close queue");
    fireEvent.pointerDown(closeBtn);
    expect(spy).toHaveBeenCalledWith("queue.closed");

    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});

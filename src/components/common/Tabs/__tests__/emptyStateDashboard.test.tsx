import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs } from "../Tabs";
import { createTabPane, useTabsStore } from "../../../../stores";

describe("empty workspace Dashboard entry point", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("dispatches the Dashboard navigation event from Open Dashboard", () => {
    const navigate = vi.fn();
    window.addEventListener("navigate", navigate);
    render(<Tabs />);

    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatchObject({ type: "navigate", detail: "/dashboard" });
    window.removeEventListener("navigate", navigate);
  });
});

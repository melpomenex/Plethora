import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLibraryAskHandoffStore } from "../../../commandPalette/libraryAskHandoff";
import * as registry from "../../tabs/TabRegistry";
import { LibraryAskHost } from "../palette/LibraryAskHost";
beforeEach(() => useLibraryAskHandoffStore.getState().consumeAsk());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("navigates to Q&A once per intent and leaves acknowledgement to the destination", () => {
  const navigate = vi.fn(); window.addEventListener("navigate", navigate);
  useLibraryAskHandoffStore.getState().requestAsk({ question: "Question", documentId: "doc-1" });
  render(<StrictMode><LibraryAskHost /></StrictMode>);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate.mock.calls[0][0].detail).toBe("/doc-qa");
  expect(useLibraryAskHandoffStore.getState().pending?.question).toBe("Question");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  act(() => {
    useLibraryAskHandoffStore.getState().consumeAsk();
    useLibraryAskHandoffStore.getState().requestOpen();
  });
  expect(navigate).toHaveBeenCalledTimes(2);
  window.removeEventListener("navigate", navigate);
});

it("acknowledges an unsupported destination and uses the canonical platform fallback", () => {
  vi.spyOn(registry, "resolveNearestAvailableTabType").mockReturnValue("dashboard");
  const navigate = vi.fn(); window.addEventListener("navigate", navigate);
  useLibraryAskHandoffStore.getState().requestOpen();
  render(<LibraryAskHost />);
  expect(navigate.mock.calls[0][0].detail).toBe("/dashboard");
  expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
  window.removeEventListener("navigate", navigate);
});

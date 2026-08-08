/**
 * Enter-to-confirm for custom modals (e.g. the priority popup's number box).
 */

import { describe, it, expect } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { Modal, ModalType, useModalStore } from "../Modal";

function show(type: ModalType) {
  const resolved: boolean[] = [];
  act(() => {
    useModalStore.getState().showModal({
      type,
      title: "t",
      content: <input data-testid="field" />,
    }).then((r) => resolved.push(r));
  });
  return resolved;
}

describe("Modal Enter key", () => {
  it("confirms a custom modal when Enter is pressed in an input", async () => {
    const resolved = show(ModalType.Custom);
    const { getByTestId } = render(<Modal />);
    await act(async () => {
      fireEvent.keyDown(getByTestId("field"), { key: "Enter" });
    });
    expect(resolved).toEqual([true]);
    expect(useModalStore.getState().modal.visible).toBe(false);
  });

  it("ignores Enter on a confirm modal", async () => {
    const resolved = show(ModalType.Confirm);
    const { getByTestId } = render(<Modal />);
    await act(async () => {
      fireEvent.keyDown(getByTestId("field"), { key: "Enter" });
    });
    expect(resolved).toEqual([]);
    expect(useModalStore.getState().modal.visible).toBe(true);
  });
});

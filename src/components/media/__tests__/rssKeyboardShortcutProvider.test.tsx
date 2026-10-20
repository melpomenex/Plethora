import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KeyboardShortcutProvider } from "../KeyboardShortcutProvider";
import {
  DEFAULT_SHORTCUTS,
  useKeyboardShortcutsStore,
  type KeyboardShortcut,
} from "../../../stores/keyboardShortcutsStore";

function shortcut(action: string, keys: string): KeyboardShortcut {
  return { id: `${action}-${keys}`, action, keys, description: "", category: "article" };
}

function renderCardFixture(onAction: (action: string) => void) {
  const cardKeyDown = vi.fn();
  render(
    <>
      <KeyboardShortcutProvider onAction={onAction} />
      <div data-rss-list-card data-expanded="true" onKeyDown={cardKeyDown}>
        <button type="button">Native action</button>
        <a href="https://example.com/article">External article</a>
        <button type="button">Details</button>
      </div>
      <button type="button">Outside card</button>
    </>,
  );
  return {
    cardKeyDown,
    native: screen.getByRole("button", { name: "Native action" }),
    external: screen.getByRole("link", { name: "External article" }),
    outside: screen.getByRole("button", { name: "Outside card" }),
    card: document.querySelector("[data-rss-list-card]") as HTMLElement,
  };
}

beforeEach(() => {
  useKeyboardShortcutsStore.setState({ shortcuts: DEFAULT_SHORTCUTS, isCustomized: false });
});

describe("KeyboardShortcutProvider List-card guard", () => {
  it("does not intercept unmodified Space or Enter on native controls in a card", () => {
    useKeyboardShortcutsStore.setState({
      shortcuts: [shortcut("markRead", " "), shortcut("openOriginal", "Enter")],
    });
    const onAction = vi.fn();
    const { native, external } = renderCardFixture(onAction);

    const space = fireEvent.keyDown(native, { key: " " });
    expect(space).toBe(true); // fireEvent returns false when preventDefault ran.
    expect(onAction).not.toHaveBeenCalled();

    const enter = fireEvent.keyDown(native, { key: "Enter" });
    expect(enter).toBe(true);
    expect(onAction).not.toHaveBeenCalled();

    const anchorEnter = fireEvent.keyDown(external, { key: "Enter" });
    expect(anchorEnter).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("leaves Shift+Enter and other modified shortcuts untouched", () => {
    useKeyboardShortcutsStore.setState({
      shortcuts: [shortcut("textView", "Shift+Enter")],
    });
    const onAction = vi.fn();
    const { native } = renderCardFixture(onAction);

    const handled = fireEvent.keyDown(native, { key: "Enter", shiftKey: true });
    expect(handled).toBe(false);
    expect(onAction).toHaveBeenCalledWith("textView");
  });

  it("lets an expanded card dismiss Escape locally, but not a collapsed card", () => {
    useKeyboardShortcutsStore.setState({ shortcuts: [shortcut("closeReader", "Escape")] });
    const onAction = vi.fn();
    const { native, card, cardKeyDown } = renderCardFixture(onAction);

    const expanded = fireEvent.keyDown(native, { key: "Escape" });
    expect(expanded).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    expect(cardKeyDown).toHaveBeenCalled();

    card.setAttribute("data-expanded", "false");
    cardKeyDown.mockClear();
    const collapsed = fireEvent.keyDown(native, { key: "Escape" });
    expect(collapsed).toBe(false);
    expect(onAction).toHaveBeenCalledWith("closeReader");
    expect(cardKeyDown).not.toHaveBeenCalled();
  });

  it("keeps j/k navigation and leaves Tab and context-menu keys alone", () => {
    const onAction = vi.fn();
    const { card, native, cardKeyDown } = renderCardFixture(onAction);

    const next = fireEvent.keyDown(card, { key: "j" });
    expect(next).toBe(false);
    expect(onAction).toHaveBeenLastCalledWith("nextArticle");

    const previous = fireEvent.keyDown(native, { key: "k" });
    expect(previous).toBe(false);
    expect(onAction).toHaveBeenLastCalledWith("prevArticle");

    onAction.mockClear();
    cardKeyDown.mockClear();
    const tab = fireEvent.keyDown(native, { key: "Tab" });
    expect(tab).toBe(true);
    expect(onAction).not.toHaveBeenCalled();

    const menu = fireEvent.keyDown(native, { key: "F10", shiftKey: true });
    expect(menu).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    expect(cardKeyDown).toHaveBeenCalled();
  });

  it("still handles shortcuts outside List cards", () => {
    useKeyboardShortcutsStore.setState({ shortcuts: [shortcut("markRead", " ") ] });
    const onAction = vi.fn();
    const { outside } = renderCardFixture(onAction);

    const handled = fireEvent.keyDown(outside, { key: " " });
    expect(handled).toBe(false);
    expect(onAction).toHaveBeenCalledWith("markRead");
  });
});

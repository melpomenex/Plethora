/**
 * Keyboard interaction coverage for the desktop selection context menu
 * (hyperlink-selection-context-actions task 3.1): Escape closes, arrow keys
 * cycle menu items, Enter activates the focused item. The menu is shared by
 * EPUB and web-article selection right-clicks, so this is the keyboard
 * contract for every surface.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../ContextMenu";

function makeItems(overrides: Partial<Record<string, () => void>> = {}): ContextMenuItem[] {
  return [
    { id: "extract", label: "Create Extract", onClick: overrides.extract ?? vi.fn() },
    { id: "sep1", label: "", type: ContextMenuItemType.Separator },
    { id: "copy", label: "Copy", onClick: overrides.copy ?? vi.fn() },
    { id: "dictionary", label: "Look up", onClick: overrides.dictionary ?? vi.fn() },
  ];
}

function renderMenu(
  items: ContextMenuItem[],
  onClose = vi.fn(),
  preserveSelection = false,
) {
  render(
    <ContextMenu
      menuId="test-menu"
      items={items}
      visible
      position={{ x: 100, y: 100 }}
      onClose={onClose}
      preserveSelection={preserveSelection}
    />,
  );
  return { onClose };
}

describe("ContextMenu keyboard interaction", () => {
  afterEach(cleanup);

  it("ArrowDown focuses menu items in order starting from the first", () => {
    renderMenu(makeItems());
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
  });

  it("ArrowUp wraps from the first item back to the last", () => {
    renderMenu(makeItems());
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(document, { key: "ArrowDown" }); // focus first
    fireEvent.keyDown(document, { key: "ArrowUp" }); // wraps backwards
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("Enter activates the focused item", () => {
    const copy = vi.fn();
    renderMenu(makeItems({ copy }));
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]); // Copy
    fireEvent.keyDown(document, { key: "Enter" });
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the menu", () => {
    const onClose = vi.fn();
    renderMenu(makeItems(), onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an accessible menu container with items carrying menuitem roles", () => {
    renderMenu(makeItems());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").length).toBe(3);
  });

  it("leaves pointer defaults alone by default", () => {
    renderMenu(makeItems());
    // True: mousedown default was not prevented for ordinary menus.
    expect(fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Copy" }))).toBe(true);
  });

  it("preserves an external selection for opt-in menus, including submenus", async () => {
    renderMenu(
      [
        {
          id: "highlight",
          label: "Highlight",
          type: ContextMenuItemType.Submenu,
          children: [{ id: "yellow", label: "Yellow highlight", onClick: vi.fn() }],
        },
        { id: "copy", label: "Copy", onClick: vi.fn() },
      ],
      vi.fn(),
      true,
    );

    expect(fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Copy" }))).toBe(false);

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight" }));
    const yellow = await screen.findByRole("menuitem", { name: "Yellow highlight" });
    expect(fireEvent.mouseDown(yellow)).toBe(false);

    // Keyboard activation is unaffected by pointer preservation.
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("keeps arrow-key activation working in an opt-in selection menu", () => {
    const copy = vi.fn();
    renderMenu(
      [
        { id: "extract", label: "Create Extract", onClick: vi.fn() },
        { id: "copy", label: "Copy", onClick: copy },
      ],
      vi.fn(),
      true,
    );

    fireEvent.keyDown(document, { key: "ArrowDown" }); // focus first
    fireEvent.keyDown(document, { key: "ArrowDown" }); // focus copy
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(copy).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { DynamicVirtualList } from "../VirtualList";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DynamicVirtualList bounded measurement", () => {
  it("does not sustain renders when measured heights oscillate below the epsilon", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    let renders = 0;
    const view = render(
      <DynamicVirtualList
        items={[{ id: "one" }]}
        itemKey={(item) => item.id}
        defaultItemHeight={40}
        renderItem={() => {
          renders += 1;
          return <span>one</span>;
        }}
      />,
    );
    const row = view.container.querySelector("[style*='position: absolute']") as HTMLElement;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ height: 40.01 } as DOMRect);
    await act(async () => { row.dispatchEvent(new Event("resize")); });
    expect(renders).toBeLessThan(8);
  });

  it("retains id-keyed measurements when items reorder", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const view = render(
      <DynamicVirtualList
        items={[{ id: "a" }, { id: "b" }]}
        itemKey={(item) => item.id}
        defaultItemHeight={10}
        renderItem={(item) => <span>{item.id}</span>}
      />,
    );
    const rows = Array.from(view.container.querySelectorAll("[style*='position: absolute']")) as HTMLElement[];
    vi.spyOn(rows[0], "getBoundingClientRect").mockReturnValue({ height: 20 } as DOMRect);
    vi.spyOn(rows[1], "getBoundingClientRect").mockReturnValue({ height: 30 } as DOMRect);
    await act(async () => { rows[0].dispatchEvent(new Event("resize")); });
    view.rerender(
      <DynamicVirtualList
        items={[{ id: "b" }, { id: "a" }]}
        itemKey={(item) => item.id}
        defaultItemHeight={10}
        renderItem={(item) => <span>{item.id}</span>}
      />,
    );
    const reordered = Array.from(view.container.querySelectorAll("[style*='position: absolute']")) as HTMLElement[];
    expect(reordered[0].textContent).toBe("b");
    expect(reordered[1].textContent).toBe("a");
  });
});

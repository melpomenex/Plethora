import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { DynamicVirtualList } from "../VirtualList";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  private targets = new Set<Element>();

  constructor(private callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }
  disconnect() {}

  observes(target: Element) {
    return this.targets.has(target);
  }

  trigger(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  ResizeObserverStub.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DynamicVirtualList bounded measurement", () => {
  it("batches initial measurements for a large review queue without recursive commits", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const height = this.style.position === "absolute" ? 48 : 600;
      return { height, top: 0, bottom: height, left: 0, right: 0, width: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(6400);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const items = Array.from({ length: 80 }, (_, index) => ({ id: `item-${index}` }));
    await act(async () => {
      render(
        <DynamicVirtualList
          items={items}
          itemKey={(item) => item.id}
          defaultItemHeight={40}
          renderItem={(item) => <span>{item.id}</span>}
        />,
      );
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
  });

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

  it("remeasures an expanded row so following rows do not overlap", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    let expanded = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const isRow = this.style.position === "absolute";
      const height = isRow && this.textContent?.includes("first")
        ? (expanded ? 120 : 40)
        : 40;
      return { height, top: 0, bottom: height, left: 0, right: 0, width: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });

    const renderItem = (item: { id: string }) => (
      <div>{item.id}{item.id === "first" && expanded ? " details" : ""}</div>
    );
    const view = render(
      <DynamicVirtualList
        items={[{ id: "first" }, { id: "second" }]}
        itemKey={(item) => item.id}
        defaultItemHeight={40}
        renderItem={renderItem}
      />,
    );
    expanded = true;
    view.rerender(
      <DynamicVirtualList
        items={[{ id: "first" }, { id: "second" }]}
        itemKey={(item) => item.id}
        defaultItemHeight={40}
        renderItem={renderItem}
      />,
    );

    const rows = Array.from(view.container.querySelectorAll("[style*='position: absolute']")) as HTMLElement[];
    const firstObserver = ResizeObserverStub.instances.find((observer) => observer.observes(rows[0]));
    await act(async () => firstObserver?.trigger(rows[0]));

    const updatedRows = Array.from(view.container.querySelectorAll("[style*='position: absolute']")) as HTMLElement[];
    expect(updatedRows[1].style.top).toBe("120px");
  });
});

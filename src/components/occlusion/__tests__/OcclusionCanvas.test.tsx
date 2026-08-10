import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { OcclusionCanvas } from "../OcclusionCanvas";
import { useOcclusionSession, type OcclusionSession } from "../useOcclusionSession";
import type { ImageAsset } from "../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import type { OcclusionViewport } from "../../../utils/occlusion";

const mockAsset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  data_url: "data:image/png;base64,iVBORw0KGgo=",
  byte_size: 123,
  sha256: "abc",
  created_at: "0",
};

function Harness({
  viewport,
  initialSuggestions,
  onSession,
}: {
  viewport?: OcclusionViewport;
  initialSuggestions?: ImageOcclusionRegion[];
  onSession: (session: OcclusionSession) => void;
}) {
  const session = useOcclusionSession({ initialViewport: viewport, initialSuggestions });
  useEffect(() => {
    onSession(session);
  }, [session, onSession]);
  return <OcclusionCanvas asset={mockAsset} session={session} />;
}

/** Render the canvas with a stubbed 800×600 image laid out at 800×600 in the
 *  container, so the viewport math has concrete numbers to work with. */
function setupCanvas(viewport?: OcclusionViewport, initialSuggestions?: ImageOcclusionRegion[]) {
  let latestSession: OcclusionSession | null = null;
  const utils = render(
    <Harness viewport={viewport} initialSuggestions={initialSuggestions} onSession={(s) => (latestSession = s)} />,
  );
  const container = utils.container.querySelector('[tabindex="0"]') as HTMLElement;
  const img = container.querySelector("img") as HTMLImageElement;

  const rect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect);
  act(() => {
    fireEvent.load(img);
  });
  return { ...utils, container, getSession: () => latestSession };
}

function draw(container: HTMLElement, from: [number, number], to: [number, number]) {
  // Each event must flush its own act() so React re-renders between the
  // pointerdown/pointermove/pointerup and the handlers see fresh state.
  act(() => fireEvent.pointerDown(container, { pointerId: 1, clientX: from[0], clientY: from[1], button: 0 }));
  act(() => fireEvent.pointerMove(container, { pointerId: 1, clientX: to[0], clientY: to[1] }));
  act(() => fireEvent.pointerUp(container, { pointerId: 1 }));
}

describe("OcclusionCanvas", () => {
  it("drawing on empty space creates a clamped region and selects it", () => {
    const { container, getSession } = setupCanvas();
    draw(container, [100, 100], [300, 200]);
    const session = getSession();
    expect(session?.regions).toHaveLength(1);
    expect(session?.regions[0]).toMatchObject({ x: 12.5, width: 25 });
    expect(session?.regions[0]?.y).toBeCloseTo(100 / 6, 9);
    expect(session?.regions[0]?.height).toBeCloseTo(100 / 6, 9);
    expect(session?.selection).toEqual([session!.regions[0].id]);
    // Exactly one history entry for the whole drag.
    act(() => session?.undo());
    expect(getSession()?.regions).toHaveLength(0);
  });

  it("clips a region dragged beyond the image edge and keeps it positive-area", () => {
    const { container, getSession } = setupCanvas();
    draw(container, [700, 500], [900, 700]);
    const region = getSession()?.regions[0];
    expect(region).toMatchObject({ x: 87.5, width: 12.5 });
    expect(region?.y).toBeCloseTo(500 / 6, 9);
    expect(region?.height).toBeCloseTo(100 / 6, 9);
  });

  it("stores fit-view-equivalent coordinates when drawing at 400% zoom", () => {
    const { container, getSession } = setupCanvas({ scale: 4, panX: 0, panY: 0 });
    draw(container, [100, 100], [300, 200]);
    // Screen 100px at scale 4 = fit 25px = 3.125% of an 800px-wide image.
    const region = getSession()?.regions[0];
    expect(region).toMatchObject({ x: 3.125, width: 6.25 });
    expect(region?.y).toBeCloseTo(25 / 6, 9);
    expect(region?.height).toBeCloseTo(25 / 6, 9);
    // Fit-to-view reset does not alter the stored coordinates.
    act(() => getSession()?.apply({ type: "setViewport", viewport: { scale: 1, panX: 0, panY: 0 } }));
    const after = getSession()?.regions[0];
    expect(after).toMatchObject({ x: 3.125, width: 6.25 });
    expect(after?.y).toBeCloseTo(25 / 6, 9);
  });

  it("panning leaves stored coordinates unchanged", () => {
    const { container, getSession } = setupCanvas({ scale: 2, panX: 100, panY: 50 });
    draw(container, [100, 100], [200, 150]);
    const before = getSession()?.regions[0];
    expect(before).toMatchObject({ x: 0, width: 6.25 });
    expect(before?.y).toBeCloseTo(25 / 6, 9);
    expect(before?.height).toBeCloseTo(25 / 6, 9);
    // Pan the canvas — coordinates must not move.
    act(() => getSession()?.apply({ type: "setViewport", viewport: { scale: 2, panX: 300, panY: 120 } }));
    expect(getSession()?.regions[0]).toEqual(before);
  });

  it("moving one region preserves every unselected region", () => {    const a: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10 };
    const b: ImageOcclusionRegion = { id: "b", x: 50, y: 50, width: 10, height: 10 };
    const { container, getSession } = setupCanvas(undefined, undefined);
    // Seed both regions by drawing, then drag region A's body (10,10) -> (40,10).
    act(() => getSession()?.apply({ type: "replaceRegions", regions: [a, b] }));
    act(() => fireEvent.pointerDown(container, { pointerId: 1, clientX: 10, clientY: 10, button: 0 }));
    act(() => fireEvent.pointerMove(container, { pointerId: 1, clientX: 40, clientY: 10 }));
    act(() => fireEvent.pointerUp(container, { pointerId: 1 }));
    const session = getSession();
    expect(session?.regions).toHaveLength(2);
    // A moved by 30px = 3.75%; B is untouched.
    expect(session?.regions.find((r) => r.id === "a")?.x).toBeCloseTo(3.75, 9);
    expect(session?.regions.find((r) => r.id === "b")).toEqual(b);
  });

  it("renders zoom controls and the zoom percentage", () => {
    const { container, getSession } = setupCanvas();
    expect(container.querySelector('[aria-label="Zoom in"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
    expect(container.textContent).toContain("100%");
    act(() => {
      fireEvent.click(container.querySelector('[aria-label="Zoom in"]') as HTMLElement);
    });
    expect(getSession()?.viewport.scale).toBe(1.25);
    expect(container.textContent).toContain("125%");
  });

  it("editing a pending suggestion accepts it in the same gesture", () => {
    const suggestion: ImageOcclusionRegion = { id: "s1", x: 50, y: 50, width: 10, height: 10, label: "axis" };
    const { container, getSession } = setupCanvas(undefined, [suggestion]);
    // The suggestion renders as a dashed overlay, distinct from regions.
    expect(document.body.querySelector('[data-testid="occlusion-suggestion-1"]')).not.toBeNull();
    // Drag its body (inside the suggestion, not on a handle) right by 40px.
    act(() => fireEvent.pointerDown(container, { pointerId: 1, clientX: 410, clientY: 305, button: 0 }));
    act(() => fireEvent.pointerMove(container, { pointerId: 1, clientX: 450, clientY: 305 }));
    act(() => fireEvent.pointerUp(container, { pointerId: 1 }));
    const session = getSession();
    // Accepted with the edit applied, no longer pending.
    expect(session?.suggestions).toEqual([]);
    expect(session?.regions).toHaveLength(1);
    expect(session?.regions[0]?.id).toBe("s1");
    expect(session?.regions[0]?.x).toBeCloseTo(55, 9);
    expect(session?.regions[0]?.y).toBeCloseTo(50, 9);
    expect(session?.regions[0]?.width).toBeCloseTo(10, 9);
    expect(session?.regions[0]?.label).toBe("axis");
    // Undo returns it to the pending state with original geometry.
    act(() => session?.undo());
    expect(getSession()?.regions).toEqual([]);
    expect(getSession()?.suggestions).toEqual([suggestion]);
  });

  it("Escape removes the region that was just drawn", () => {
    const { container, getSession } = setupCanvas();
    draw(container, [100, 100], [300, 200]);
    const drawn = getSession()?.regions[0];
    expect(drawn).toBeDefined();
    expect(getSession()?.selection).toEqual([drawn!.id]);
    act(() => fireEvent.keyDown(container, { key: "Escape" }));
    expect(getSession()?.regions).toEqual([]);
    expect(getSession()?.selection).toEqual([]);
    // The removal is a normal undoable mutation.
    act(() => getSession()?.undo());
    expect(getSession()?.regions).toHaveLength(1);
  });

  it("Escape after drawing several regions removes only the latest", () => {
    const { container, getSession } = setupCanvas();
    draw(container, [100, 100], [300, 200]); // region 1
    draw(container, [400, 100], [500, 200]); // region 2
    const session = getSession();
    const [first, second] = session!.regions;
    act(() => fireEvent.keyDown(container, { key: "Escape" }));
    const after = getSession();
    expect(after?.regions).toHaveLength(1);
    expect(after?.regions[0]?.id).toBe(first?.id);
    expect(after?.regions[0]?.id).not.toBe(second?.id);
  });

  it("Escape clears the selection instead of deleting when the last-drawn region is not the sole selection", () => {
    const { container, getSession } = setupCanvas();
    draw(container, [100, 100], [300, 200]); // region 1
    draw(container, [400, 100], [500, 200]); // region 2
    const session = getSession();
    const [first] = session!.regions;
    // Select the older region — Escape must not delete it.
    act(() => session?.apply({ type: "select", ids: [first!.id ?? ""] }));
    act(() => fireEvent.keyDown(container, { key: "Escape" }));
    const after = getSession();
    expect(after?.regions).toHaveLength(2);
    expect(after?.selection).toEqual([]);
  });
});

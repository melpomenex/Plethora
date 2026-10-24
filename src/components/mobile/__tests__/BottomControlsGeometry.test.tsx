import { act, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomControlsGeometryProvider, bottomDockClearance, useBottomControlsGeometry, usePublishBottomControls } from "../BottomControlsGeometry";

function Consumer() {
  const geometry = useBottomControlsGeometry();
  return <output data-testid="geometry">{geometry ? JSON.stringify({ ...geometry, clearance: bottomDockClearance(geometry) }) : "empty"}</output>;
}
function Fixture({ visible = true, blocked = false, audio = false }: { visible?: boolean; blocked?: boolean; audio?: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  usePublishBottomControls({ navRef, audioRef, audioVisible: audio, pillRef, viewport: { top: 100, height: 700, width: 390, safeTop: 0, safeBottom: 34, keyboardHeight: 0 }, pillVisible: visible, blocked, fullscreen: false });
  return <><nav ref={navRef} data-control="nav" />{audio && <div ref={audioRef} data-control="audio" />}<button ref={pillRef} hidden={!visible} data-control="pill">Assistant</button></>;
}
afterEach(() => vi.restoreAllMocks());
describe("shell bottom geometry", () => {
  it("has an empty default outside the mobile shell", () => {
    render(<Consumer />); expect(screen.getByTestId("geometry")).toHaveTextContent("empty");
  });
  it("measures visible controls, releases hidden reservations, and clears on unmount", async () => {
    let pillTop = 684;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this.dataset.control === "pill" ? pillTop : 740;
      return { top, bottom: top + 48, left: 0, right: 200, width: 200, height: 48, x: 0, y: top, toJSON() {} };
    });
    const view = render(<BottomControlsGeometryProvider><Fixture /><Consumer /></BottomControlsGeometryProvider>);
    const current = () => JSON.parse(screen.getByTestId("geometry").textContent!);
    expect(current()).toMatchObject({ occupiedTop: 684, clearance: 124, viewportTop: 100, blocked: false });
    pillTop = 660;
    act(() => { document.querySelector("nav")!.dispatchEvent(new Event("transitionend")); });
    expect(current().clearance).toBe(148);
    view.rerender(<BottomControlsGeometryProvider><Fixture visible={false} blocked /><Consumer /></BottomControlsGeometryProvider>);
    expect(current()).toMatchObject({ occupiedTop: 740, clearance: 68, blocked: true });
    act(() => { document.querySelector("nav")!.classList.add("hidden"); });
    await waitFor(() => expect(current().clearance).toBe(46));
    expect(current().occupiedTop).toBeUndefined();
    view.rerender(<BottomControlsGeometryProvider><Consumer /></BottomControlsGeometryProvider>);
    expect(screen.getByTestId("geometry")).toHaveTextContent("empty");
  });
  it("includes a newly mounted audio dock in the same bottom boundary without adding safe area twice", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this.dataset.control === "audio" ? 676 : 740;
      return { top, bottom: top + 64, left: 0, right: 390, width: 390, height: 64, x: 0, y: top, toJSON() {} };
    });
    const view = render(<BottomControlsGeometryProvider><Fixture visible={false} /><Consumer /></BottomControlsGeometryProvider>);
    expect(JSON.parse(screen.getByTestId("geometry").textContent!).occupiedTop).toBe(740);
    view.rerender(<BottomControlsGeometryProvider><Fixture visible={false} audio /><Consumer /></BottomControlsGeometryProvider>);
    expect(JSON.parse(screen.getByTestId("geometry").textContent!)).toMatchObject({ occupiedTop: 676, clearance: 132, safeBottom: 34 });
    view.rerender(<BottomControlsGeometryProvider><Fixture visible={false} /><Consumer /></BottomControlsGeometryProvider>);
    expect(JSON.parse(screen.getByTestId("geometry").textContent!).occupiedTop).toBe(740);
  });
});

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmbeddedImageViewer, type EmbeddedImageRequest } from "../EmbeddedImageViewer";

function triggerButton() {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Source image";
  document.body.appendChild(trigger);
  return trigger;
}

function imageRequest(trigger: HTMLElement): EmbeddedImageRequest {
  return {
    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='600'/%3E",
    alt: "Architecture diagram",
    caption: "Figure 1. Application architecture",
    trigger,
  };
}

function setBounds(element: HTMLElement, bounds: { width: number; height: number; left?: number; top?: number }) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: bounds.left ?? 0,
    y: bounds.top ?? 0,
    left: bounds.left ?? 0,
    top: bounds.top ?? 0,
    width: bounds.width,
    height: bounds.height,
    right: (bounds.left ?? 0) + bounds.width,
    bottom: (bounds.top ?? 0) + bounds.height,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("EmbeddedImageViewer", () => {
  it("fits without cropping, supports explicit scale controls, and clamps pan to image bounds", async () => {
    const trigger = triggerButton();
    const onClose = vi.fn();
    render(<EmbeddedImageViewer image={imageRequest(trigger)} onClose={onClose} />);

    const stage = document.querySelector(".embedded-image-viewer__stage") as HTMLElement;
    const image = screen.getByRole("img", { name: "Architecture diagram" }) as HTMLImageElement;
    setBounds(stage, { width: 800, height: 500 });
    act(() => fireEvent(window, new Event("resize")));
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1200 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 600 });
    fireEvent.load(image);

    expect(screen.getByText("Figure 1. Application architecture")).toBeTruthy();
    expect(screen.getByText("64%")).toBeTruthy();
    expect(image.style.width).toBe("1200px");
    expect(image.style.height).toBe("600px");

    fireEvent.click(screen.getByRole("button", { name: "Zoom In" }));
    expect(screen.getByText("80%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View at 100 percent" }));
    expect(document.querySelector(".embedded-image-viewer__scale")?.textContent).toBe("100%");

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 900, clientY: 900 });
    expect(image.style.transform).toBe("translate(200px, 50px) scale(1)");

    fireEvent.click(screen.getByRole("button", { name: "Fit image to screen" }));
    expect(screen.getByText("64%")).toBeTruthy();
    expect(image.style.transform).toBe("translate(0px, 0px) scale(0.64)");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("contains focus, locks page scrolling, dismisses with Escape, and restores trigger focus", async () => {
    const trigger = triggerButton();
    trigger.focus();
    const selectedText = document.createTextNode("selected reader text");
    document.body.appendChild(selectedText);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const onClose = vi.fn();
    const { rerender } = render(<EmbeddedImageViewer image={imageRequest(trigger)} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(close, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Zoom Out" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Zoom Out" }), { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<></>);
    expect(document.body.style.overflow).toBe("");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(selection?.toString()).toBe("selected reader text");
    selectedText.remove();
    trigger.remove();
  });

  it("closes from the backdrop and falls back to the reader when the trigger was unmounted", async () => {
    const trigger = triggerButton();
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.appendChild(fallback);
    const fallbackFocusRef = { current: fallback };
    const { unmount } = render(
      <EmbeddedImageViewer image={imageRequest(trigger)} onClose={() => {}} fallbackFocusRef={fallbackFocusRef} />,
    );

    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    fireEvent.click(dialog);
    trigger.remove();
    unmount();
    await waitFor(() => expect(fallback).toHaveFocus());
    fallback.remove();
  });

  it("dismisses on the stage backdrop outside the image without closing after a pan", () => {
    const trigger = triggerButton();
    const onClose = vi.fn();
    render(<EmbeddedImageViewer image={imageRequest(trigger)} onClose={onClose} />);

    const stage = document.querySelector(".embedded-image-viewer__stage") as HTMLElement;
    const image = screen.getByRole("img", { name: "Architecture diagram" }) as HTMLImageElement;
    setBounds(stage, { width: 800, height: 500 });
    setBounds(image, { width: 600, height: 300, left: 100, top: 100 });

    fireEvent.click(stage, { clientX: 400, clientY: 250 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(stage, { clientX: 50, clientY: 250 });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 400, clientY: 250 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 10, clientY: 250 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 10, clientY: 250 });
    fireEvent.click(stage, { clientX: 10, clientY: 250 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("maps viewer shortcuts and wheel or pinch gestures to bounded zoom", () => {
    const trigger = triggerButton();
    render(<EmbeddedImageViewer image={imageRequest(trigger)} onClose={() => {}} />);
    const stage = document.querySelector(".embedded-image-viewer__stage") as HTMLElement;
    const dialog = screen.getByRole("dialog");
    const image = screen.getByRole("img", { name: "Architecture diagram" }) as HTMLImageElement;
    setBounds(stage, { width: 800, height: 500 });
    act(() => fireEvent(window, new Event("resize")));
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1200 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 600 });
    fireEvent.load(image);

    expect(stage.style.touchAction).toBe("none");
    fireEvent.keyDown(dialog, { key: "+" });
    expect(document.querySelector(".embedded-image-viewer__scale")?.textContent).toBe("80%");
    fireEvent.keyDown(dialog, { key: "0" });
    expect(document.querySelector(".embedded-image-viewer__scale")?.textContent).toBe("100%");
    fireEvent.wheel(stage, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(Number.parseInt(document.querySelector(".embedded-image-viewer__scale")?.textContent ?? "0", 10)).toBeGreaterThan(100);

    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: "touch", button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerDown(stage, { pointerId: 2, pointerType: "touch", button: 0, clientX: 400, clientY: 250 });
    fireEvent.pointerMove(stage, { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 250 });
    expect(Number.parseInt(document.querySelector(".embedded-image-viewer__scale")?.textContent ?? "0", 10)).toBeGreaterThan(200);
  });
});

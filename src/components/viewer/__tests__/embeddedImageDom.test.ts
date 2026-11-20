import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { attachEmbeddedImageViewer } from "../embeddedImageDom";

function makeFrameDocument(): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("Expected a same-origin iframe document");
  doc.body.innerHTML = '<figure><img src="fallback.png" alt="Diagram"><figcaption>Chapter map</figcaption></figure>';
  return doc;
}

describe("attachEmbeddedImageViewer", () => {
  it("decorates iframe images for keyboard access and opens the browser-resolved source with its caption", () => {
    const doc = makeFrameDocument();
    const img = doc.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "currentSrc", { configurable: true, value: "https://assets.test/diagram-2x.png" });
    const open = vi.fn();
    const detach = attachEmbeddedImageViewer({ root: doc, genericLabel: "Image", open });

    expect(img.getAttribute("role")).toBe("button");
    expect(img.getAttribute("tabindex")).toBe("0");
    expect(img.getAttribute("aria-label")).toBe("Diagram");
    expect(img.parentElement?.querySelector(".document-image-viewer-affordance svg")).toBeTruthy();

    fireEvent.keyDown(img, { key: "Enter" });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      src: "https://assets.test/diagram-2x.png",
      alt: "Diagram",
      caption: "Chapter map",
      trigger: img,
    }));
    fireEvent.click(img);
    expect(open).toHaveBeenCalledTimes(2);

    detach();
    fireEvent.click(img);
    expect(open).toHaveBeenCalledTimes(2);
    doc.defaultView?.frameElement?.remove();
  });

  it("suppresses EPUB image gesture propagation and decorates images added to a mounted section", async () => {
    const doc = makeFrameDocument();
    const open = vi.fn();
    const parentTouch = vi.fn();
    doc.addEventListener("touchstart", parentTouch);
    const detach = attachEmbeddedImageViewer({
      root: doc,
      genericLabel: "Image",
      open,
      suppressReaderGestures: true,
    });

    const added = doc.createElement("img");
    added.src = "chapter-2.png";
    doc.body.appendChild(added);
    await act(async () => {});
    expect(added.getAttribute("tabindex")).toBe("0");
    fireEvent.touchStart(added);
    expect(parentTouch).not.toHaveBeenCalled();
    fireEvent.keyDown(added, { key: " " });
    expect(open).toHaveBeenCalledTimes(1);

    detach();
    doc.defaultView?.frameElement?.remove();
  });
});

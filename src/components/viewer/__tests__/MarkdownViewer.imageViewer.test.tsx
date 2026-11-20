import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Document as DocType } from "../../../types";
import { MarkdownViewer } from "../MarkdownViewer";

const document = {
  id: "doc-image-viewer",
  title: "Image Viewer Markdown",
  filePath: "/tmp/image-viewer.md",
  fileType: "markdown",
} as unknown as DocType;

describe("MarkdownViewer embedded image activation", () => {
  it("exposes the rendered image to keyboard users and forwards the rendered source", () => {
    const onImageOpen = vi.fn();
    const { container } = render(
      <MarkdownViewer
        document={document}
        content="![System diagram](https://assets.test/system.png)"
        onImageOpen={onImageOpen}
      />,
    );
    const image = container.querySelector("img") as HTMLImageElement;

    expect(image.getAttribute("role")).toBe("button");
    expect(image.getAttribute("tabindex")).toBe("0");
    expect(image.getAttribute("aria-label")).toBe("System diagram");
    expect(container.querySelector(".document-image-viewer-affordance")).toBeTruthy();

    fireEvent.keyDown(image, { key: " " });
    expect(onImageOpen).toHaveBeenCalledWith(expect.objectContaining({
      src: image.currentSrc || image.src,
      alt: "System diagram",
      trigger: image,
    }));
    fireEvent.click(image);
    fireEvent.keyDown(image, { key: "Enter" });
    expect(onImageOpen).toHaveBeenCalledTimes(3);
  });

  it("uses the localized generic image description when alternative text is missing", () => {
    const { container } = render(
      <MarkdownViewer document={document} content="![](https://assets.test/untitled.png)" onImageOpen={() => {}} />,
    );
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("aria-label")).toBe("Image");
  });
});

import { useCallback, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEmbeddedImageViewer } from "../useEmbeddedImageViewer";

function RssProseHarness({
  html,
  onLinkClick,
}: {
  html: string;
  onLinkClick?: () => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [proseRoot, setProseRoot] = useState<HTMLDivElement | null>(null);
  const setProseRef = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    setProseRoot(el);
  }, []);
  const { viewerOverlay } = useEmbeddedImageViewer(proseRoot, contentRef);

  return (
    <div>
      <div
        ref={setProseRef}
        className="rss-reading-prose"
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a[href]");
          if (link) {
            e.preventDefault();
            onLinkClick?.();
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewerOverlay}
    </div>
  );
}

describe("useEmbeddedImageViewer", () => {
  it("opens the zoomable EmbeddedImageViewer when clicking an RSS article image and closes on Escape", () => {
    render(
      <RssProseHarness html='<figure><img src="https://example.test/chart.png" alt="Quarterly chart" /><figcaption>Q4 growth</figcaption></figure>' />,
    );

    const img = document.querySelector(".rss-reading-prose img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("role")).toBe("button");
    expect(img.getAttribute("tabindex")).toBe("0");

    fireEvent.click(img);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /zoom in/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /zoom out/i })).toBeTruthy();
    expect(within(dialog).getByText("Q4 growth")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("intercepts clicks on linked images without triggering the outer anchor handler", () => {
    const onLinkClick = vi.fn();
    render(
      <RssProseHarness
        html='<p><a href="https://example.test/post"><img src="https://example.test/photo.jpg" alt="Linked photo" /></a></p>'
        onLinkClick={onLinkClick}
      />,
    );

    const img = document.querySelector(".rss-reading-prose img") as HTMLImageElement;
    fireEvent.click(img);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onLinkClick).not.toHaveBeenCalled();
  });
});

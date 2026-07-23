import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ScrollOverlayControls } from "../ScrollOverlayControls";

const defaultProps = {
  showControls: true,
  currentIndex: 0,
  totalItems: 5,
  sessionOffset: 0,
  itemType: "document",
  itemTitle: "Test Document",
  itemDocumentId: "doc-123",
  isNewDocument: false,
  isRating: false,
  scrollViewMode: "document",
  helpText: "Test Help Text",
  isEpub: false,
  isMobile: false,
  ratingOrbsPosition: "right" as const,
  onUpdateRatingOrbsPosition: vi.fn(),
  onExit: vi.fn(),
  onShowSettings: vi.fn(),
  onShowRssSettings: vi.fn(),
  onSetScrollViewMode: vi.fn(),
  onOpenExtractDialog: vi.fn(),
  onRate: vi.fn(),
  onDismiss: vi.fn(),
  onGoToNext: vi.fn(),
  onGoToPrevious: vi.fn(),
};

describe("ScrollOverlayControls Rating Orbs Snap Positioning", () => {
  it("hides rating actions until their visibility gate is opened", () => {
    render(<ScrollOverlayControls {...defaultProps} showRatingControls={false} />);
    expect(screen.queryByTitle("Again")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Change panel edge")).not.toBeInTheDocument();
  });

  it("does not render embedded EPUB TOC and reading settings in the top bar", () => {
    const openToc = vi.fn();
    const openSettings = vi.fn();
    const previousPage = vi.fn();
    const nextPage = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        isEpub
        onOpenEpubToc={openToc}
        onOpenEpubSettings={openSettings}
        onEpubPreviousPage={previousPage}
        onEpubNextPage={nextPage}
      />
    );

    expect(screen.queryByTitle("Table of contents")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Reading settings")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Previous EPUB page")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Next EPUB page")).not.toBeInTheDocument();
  });

  it("routes document, extracts, and learning-card view selections", () => {
    const onSetScrollViewMode = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        showRatingControls={false}
        scrollViewMode="extracts"
        onSetScrollViewMode={onSetScrollViewMode}
      />
    );

    fireEvent.click(screen.getByTitle("View document"));
    fireEvent.click(screen.getByTitle("View extracts"));
    fireEvent.click(screen.getByTitle("View learning cards"));

    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(1, "document");
    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(2, "extracts");
    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(3, "cards");
  });

  it("renders with right snapping layout by default", () => {
    const { container } = render(<ScrollOverlayControls {...defaultProps} />);
    const docControl = container.querySelector(".right-6");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-col");
  });

  it("renders with left snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="left" />
    );
    const docControl = container.querySelector(".left-6");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-col");
  });

  it("renders with top snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="top" />
    );
    const docControl = container.querySelector(".top-28");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-row");
  });

  it("renders with bottom snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="bottom" />
    );
    const docControl = container.querySelector(".bottom-28");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-row");
  });

  it("toggles the position snap configuration menu on click", () => {
    const onUpdate = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        onUpdateRatingOrbsPosition={onUpdate}
      />
    );
    
    // Position menu config button title is "Change panel edge"
    const configBtn = screen.getByTitle("Change panel edge");
    expect(configBtn).toBeInTheDocument();
    
    // Initially the buttons like "Move Left" are not visible
    expect(screen.queryByTitle("Move Left")).not.toBeInTheDocument();
    
    // Click to open menu
    fireEvent.click(configBtn);
    
    // Menu buttons should show up
    expect(screen.getByTitle("Move Left")).toBeInTheDocument();
    expect(screen.getByTitle("Move Top")).toBeInTheDocument();
    expect(screen.getByTitle("Move Bottom")).toBeInTheDocument();
    expect(screen.getByTitle("Move Right")).toBeInTheDocument();

    // Click "Move Left" and assert callbacks
    fireEvent.click(screen.getByTitle("Move Left"));
    expect(onUpdate).toHaveBeenCalledWith("left");
  });
});

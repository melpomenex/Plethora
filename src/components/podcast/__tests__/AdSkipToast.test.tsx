import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdSkipToast, formatAdDuration } from "../AdSkipToast";

describe("AdSkipToast", () => {
  it("formats ad duration strings cleanly", () => {
    expect(formatAdDuration(30)).toBe("30s");
    expect(formatAdDuration(75)).toBe("1m 15s");
    expect(formatAdDuration(120)).toBe("2m");
  });

  it("renders toast with correct sponsor title and duration", () => {
    render(
      <AdSkipToast
        open={true}
        intervalId="ad-1"
        brand="Squarespace"
        fromSec={10}
        toSec={85}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByTestId("ad-skip-toast")).toBeInTheDocument();
    expect(screen.getByText(/Skipped ad:/)).toBeInTheDocument();
    expect(screen.getByText("Squarespace")).toBeInTheDocument();
    expect(screen.getByText(/\(1m 15s\)/)).toBeInTheDocument();
  });

  it("calls onUndo with interval ID and start position when Undo is clicked", () => {
    const handleUndo = vi.fn();
    const handleDismiss = vi.fn();
    render(
      <AdSkipToast
        open={true}
        intervalId="ad-test-99"
        category="external_ad"
        fromSec={120}
        toSec={180}
        onUndo={handleUndo}
        onDismiss={handleDismiss}
      />
    );

    const undoBtn = screen.getByTestId("ad-skip-undo-btn");
    fireEvent.click(undoBtn);

    expect(handleUndo).toHaveBeenCalledWith("ad-test-99", 120);
    expect(handleDismiss).toHaveBeenCalled();
  });

  it("calls onDismiss when close button is clicked", () => {
    const handleDismiss = vi.fn();
    render(
      <AdSkipToast
        open={true}
        intervalId="ad-test-99"
        category="external_ad"
        fromSec={10}
        toSec={40}
        onUndo={vi.fn()}
        onDismiss={handleDismiss}
      />
    );

    fireEvent.click(screen.getByTestId("ad-skip-dismiss-btn"));
    expect(handleDismiss).toHaveBeenCalled();
  });

  it("does not render when open is false", () => {
    render(
      <AdSkipToast
        open={false}
        intervalId="ad-test-99"
        fromSec={10}
        toSec={40}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByTestId("ad-skip-toast")).not.toBeInTheDocument();
  });
});

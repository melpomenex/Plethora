import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueueExtractsView } from "../QueueExtractsView";

vi.mock("../../extracts/ExtractsList", () => ({
  ExtractsList: ({ documentId }: { documentId: string }) => (
    <div data-testid="extracts-list">Extracts for {documentId}</div>
  ),
}));

describe("QueueExtractsView", () => {
  it("owns a bounded, inset scroll surface for the shared extracts list", () => {
    const { container } = render(<QueueExtractsView documentId="doc-123" />);
    const view = container.querySelector("[data-queue-extracts-view='true']");

    expect(view).toBeInTheDocument();
    expect(view).toHaveClass(
      "h-full",
      "min-h-0",
      "min-w-0",
      "overflow-y-auto",
      "overscroll-contain",
      "touch-pan-y",
      "px-3",
      "sm:px-4",
      "md:px-6",
    );
    expect(view?.className).toContain(
      "pt-[calc(4.5rem+env(safe-area-inset-top,0px))]",
    );
    expect(view?.className).toContain(
      "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]",
    );
    expect(screen.getByTestId("extracts-list")).toHaveTextContent("doc-123");
  });
});

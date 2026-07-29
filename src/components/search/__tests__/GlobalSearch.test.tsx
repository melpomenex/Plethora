import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalSearch, SearchResultType, type SearchQuery, type SearchResult } from "../GlobalSearch";

describe("GlobalSearch keyboard navigation", () => {
  const buildResults = (): SearchResult[] => [
    {
      id: "section-settings",
      type: SearchResultType.Command,
      title: "Settings",
      excerpt: "Open Settings",
      score: 1,
      metadata: {
        resultKind: "section",
      },
    },
    {
      id: "doc-1",
      type: SearchResultType.Document,
      title: "My Document",
      score: 0.9,
      metadata: {
        documentId: "doc-1",
      },
    },
  ];

  it("activates highlighted section with Enter", async () => {
    const onResultClick = vi.fn();
    const onSearch = vi.fn(async (_query: SearchQuery) => buildResults());

    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={onSearch}
        onResultClick={onResultClick}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "settings" } });
    await act(async () => {});

    // Wait for results to render. The keydown handler is registered in an
    // effect that closes over `results`/`selectedIndex`, so we must wait until
    // the result row is committed (and the effect re-binds the listener with
    // the populated results) before dispatching Enter. Querying the selected
    // row guarantees the effect for the populated state has run.
    const settingsRow = await waitFor(
      () => screen.getByText("Settings"),
      { timeout: 2000 }
    );
    await waitFor(() =>
      expect(settingsRow.closest('[role="button"]')).toHaveClass("border-primary-400")
    );

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() =>
      expect(onResultClick).toHaveBeenCalledWith(expect.objectContaining({ id: "section-settings" }))
    );
  });

  it("supports ArrowDown then Enter for mixed results and keeps document-open behavior", async () => {
    const onResultClick = vi.fn();
    const onSearch = vi.fn(async (_query: SearchQuery) => buildResults());

    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={onSearch}
        onResultClick={onResultClick}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "set" } });
    await act(async () => {});

    // Wait for the document result to render AND be confirmed committed before
    // driving keyboard navigation (see the note on the Enter test above).
    const docRow = await waitFor(
      () => screen.getByText("My Document"),
      { timeout: 2000 }
    );
    await waitFor(() =>
      expect(docRow.closest('[role="button"]')).toBeInTheDocument()
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() =>
      expect(onResultClick).toHaveBeenCalledWith(expect.objectContaining({
        id: "doc-1",
        type: SearchResultType.Document,
      }))
    );
  });
});

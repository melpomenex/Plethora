import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  updateDocument: vi.fn(),
  clearDocumentCategory: vi.fn(),
  getDocuments: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  updateDocument: mocks.updateDocument,
  clearDocumentCategory: mocks.clearDocumentCategory,
  getDocuments: mocks.getDocuments,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

import { ItemCategoryEditor } from "../ItemCategoryEditor";
import { useDocumentStore } from "../../../stores/documentStore";

const baseDoc: Record<string, unknown> = {
  id: "doc-1",
  title: "Categorized",
  category: "History",
  tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocuments.mockResolvedValue([]);
  mocks.updateDocument.mockImplementation(async (_id: string, updates: { category?: string }) => ({
    ...baseDoc,
    category: updates.category,
  }));
  mocks.clearDocumentCategory.mockResolvedValue({ ...baseDoc, category: null });
  useDocumentStore.setState({
    documents: [
      { id: "doc-1", title: "Categorized", category: "History", tags: [] },
      { id: "doc-2", title: "Other", category: "Physics", tags: [] },
    ] as never[],
  });
});

afterEach(() => {
  localStorage.clear();
});

describe("ItemCategoryEditor (bug 11: category editing from library/document surfaces)", () => {
  it("offers preset chips derived from the union of existing document categories", () => {
    render(<ItemCategoryEditor documentId="doc-1" category="History" />);
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Physics" })).toBeInTheDocument();
  });

  it("persisting a chip click goes through updateDocument with the category", async () => {
    render(<ItemCategoryEditor documentId="doc-1" category="History" />);
    fireEvent.click(screen.getByRole("button", { name: "Physics" }));

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledTimes(1));
    const [id, updates] = mocks.updateDocument.mock.calls[0];
    expect(id).toBe("doc-1");
    expect(updates.category).toBe("Physics");
  });

  it("clicking the selected chip clears via the dedicated clear path", async () => {
    render(<ItemCategoryEditor documentId="doc-1" category="History" />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    await waitFor(() => expect(mocks.clearDocumentCategory).toHaveBeenCalledWith("doc-1"));
    // The clear never routes through updateDocument — an empty category there
    // means "not provided", which is exactly the old no-clear bug.
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it("free-text entry persists a brand-new category", async () => {
    render(<ItemCategoryEditor documentId="doc-1" category={null} />);
    const input = screen.getByLabelText("itemDetails.categoryPlaceholder");
    fireEvent.change(input, { target: { value: "Philosophy" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledTimes(1));
    expect(mocks.updateDocument.mock.calls[0][1].category).toBe("Philosophy");
  });

  it("reports the persisted value to the host surface", async () => {
    const onCategoryPersisted = vi.fn();
    render(
      <ItemCategoryEditor documentId="doc-1" category="History" onCategoryPersisted={onCategoryPersisted} />
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(onCategoryPersisted).toHaveBeenCalledWith(null));

    fireEvent.click(screen.getByRole("button", { name: "Physics" }));
    await waitFor(() => expect(onCategoryPersisted).toHaveBeenCalledWith("Physics"));
  });
});

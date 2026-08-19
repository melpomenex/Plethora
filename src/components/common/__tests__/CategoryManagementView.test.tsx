import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

vi.mock("../../../api/categories", () => ({
  getCategories: mocks.getCategories,
  createCategory: mocks.createCategory,
  renameCategory: mocks.renameCategory,
  deleteCategory: mocks.deleteCategory,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key}:${vars.name ?? vars.count ?? ""}` : key,
    locale: "en",
  }),
}));

import { CategoryManagementView } from "../CategoryManagementView";
import { useCategoriesStore } from "../../../stores/categoriesStore";

const list = [
  { name: "Work", itemCount: 3 },
  { name: "Personal", itemCount: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
  mocks.getCategories.mockResolvedValue(list);
  mocks.createCategory.mockResolvedValue({ id: "c1", name: "NewCat" });
  mocks.renameCategory.mockResolvedValue({ documentsUpdated: 3, extractsUpdated: 1 });
  mocks.deleteCategory.mockResolvedValue({ documentsCleared: 3, extractsCleared: 1 });
});

describe("CategoryManagementView", () => {
  it("lists categories with item counts and a count header", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());
    expect(screen.getByText("Personal")).toBeInTheDocument();
    // item counts render (one per row)
    expect(screen.getAllByText("categoryManagement.itemsCount:", { exact: false })).toHaveLength(2);
  });

  it("creates a category from the create row (Enter)", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());

    const input = screen.getByLabelText("categoryManagement.createPlaceholder");
    fireEvent.change(input, { target: { value: "Philosophy" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.createCategory).toHaveBeenCalledWith("Philosophy"));
  });

  it("rejects an empty category name with a message", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());

    const input = screen.getByLabelText("categoryManagement.createPlaceholder");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.createCategory).not.toHaveBeenCalled();
    expect(screen.getByText("categoryManagement.emptyName")).toBeInTheDocument();
  });

  it("renames a category (inline input) and propagates via the API", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("categoryManagement.renameAction:Work"));
    const renameInput = screen.getByLabelText("categoryManagement.renameInput");
    fireEvent.change(renameInput, { target: { value: "Career" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => expect(mocks.renameCategory).toHaveBeenCalledWith("Work", "Career"));
  });

  it("deletes a category only after inline confirmation", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());

    // Clicking delete reveals a confirm button; the delete is not fired yet.
    fireEvent.click(screen.getByLabelText("categoryManagement.deleteAction:Work"));
    expect(mocks.deleteCategory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "categoryManagement.confirm" }));
    await waitFor(() => expect(mocks.deleteCategory).toHaveBeenCalledWith("Work"));
  });

  it("filters the list by search query", async () => {
    render(<CategoryManagementView open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());

    const search = screen.getByLabelText("categoryManagement.searchPlaceholder");
    fireEvent.change(search, { target: { value: "Work" } });

    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(<CategoryManagementView open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("categoryManagement.close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

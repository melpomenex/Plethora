import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedViewsMenu } from "../SavedViewsMenu";
import type { SavedView } from "../../../stores/savedViewsStore";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        "documentsView.savedViews": "Saved Views",
        "documentsView.saveCurrentView": "Save Current View",
        "documentsView.noSavedViews": "No saved views yet",
        "documentsView.viewModified": "Current filters differ from saved view",
        "documentsView.modified": "Modified",
        "documentsView.viewActions": `Actions for ${params?.name ?? ""}`,
        "documentsView.renameView": "Rename",
        "documentsView.updateWithCurrentFilters": "Update with current filters",
        "documentsView.duplicateView": "Duplicate",
        "documentsView.moveViewUp": "Move up",
        "documentsView.moveViewDown": "Move down",
        "documentsView.deleteView": "Delete",
        "documentsView.clearActiveView": "Clear active view",
      };
      return map[key] ?? key;
    },
  }),
}));

const sampleViews: SavedView[] = [
  {
    id: "v1",
    name: "Philosophy",
    query: "kant",
    sortKey: "priority",
    sortDirection: "desc",
    mode: "list",
    showNextAction: false,
    fileTypeFilter: "all",
  },
  {
    id: "v2",
    name: "Computer Science",
    query: "systems",
    sortKey: "added",
    sortDirection: "desc",
    mode: "grid",
    showNextAction: true,
    fileTypeFilter: "pdf",
  },
];

describe("SavedViewsMenu", () => {
  it.each(["desktop", "mobile"] as const)(
    "supports apply, actions menu, delete, rename, update, duplicate, reorder, and clear on %s",
    (variant) => {
      const handlers = {
        onApplyView: vi.fn(),
        onClearActiveView: vi.fn(),
        onSaveView: vi.fn(),
        onRenameView: vi.fn(),
        onUpdateView: vi.fn(),
        onDuplicateView: vi.fn(),
        onMoveView: vi.fn(),
        onDeleteView: vi.fn(),
      };

      render(
        <SavedViewsMenu
          variant={variant}
          savedViews={sampleViews}
          activeViewId="v1"
          isActiveViewModified={true}
          {...handlers}
        />
      );

      const trigger = screen.getByTestId(`saved-views-trigger-${variant}`);
      expect(trigger.textContent).toContain("Philosophy");
      fireEvent.click(trigger);

      expect(screen.getByTestId(`saved-views-menu-${variant}`)).toBeTruthy();
      expect(screen.getByText("Modified")).toBeTruthy();

      // Open actions for Philosophy
      fireEvent.click(screen.getByLabelText("Actions for Philosophy"));
      fireEvent.click(screen.getByText("Delete"));
      expect(handlers.onDeleteView).toHaveBeenCalledWith("v1");

      // Reopen actions for Computer Science and test Move up / Rename / Update / Duplicate
      fireEvent.click(screen.getByLabelText("Actions for Computer Science"));
      fireEvent.click(screen.getByText("Move up"));
      expect(handlers.onMoveView).toHaveBeenCalledWith("v2", "up");

      fireEvent.click(screen.getByText("Rename"));
      expect(handlers.onRenameView).toHaveBeenCalledWith("v2");

      // Reopen menu to test Clear active view
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText("Clear active view"));
      expect(handlers.onClearActiveView).toHaveBeenCalledTimes(1);
    }
  );
});

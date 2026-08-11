import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../../test/utils";

const mocks = vi.hoisted(() => ({
  persistItemTags: vi.fn(),
  publishItemTagsUpdated: vi.fn(),
  subscribeItemTagsUpdated: vi.fn(() => () => {}),
}));

vi.mock("../../../lib/tagEditing/mutationAdapter", () => ({
  persistItemTags: mocks.persistItemTags,
}));
vi.mock("../../../lib/tagEditing/itemTagEvents", () => ({
  publishItemTagsUpdated: mocks.publishItemTagsUpdated,
  subscribeItemTagsUpdated: mocks.subscribeItemTagsUpdated,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return key.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k]));
      }
      return key;
    },
    locale: "en",
  }),
}));
vi.mock("../../../components/common/Toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), promise: vi.fn() }),
}));

import { ItemTagEditor } from "../ItemTagEditor";
import { CompactTagEditor } from "../CompactTagEditor";
import type { ItemTagTarget } from "../../../lib/tagEditing/types";

const HOSTS = [
  { host: "Queue", type: "learning-item" as const, id: "q-card-1", tags: ["due"] },
  { host: "Schedule", type: "extract" as const, id: "s-extract-1", tags: ["soon"] },
  { host: "Documents", type: "document" as const, id: "d-doc-1", tags: ["library"] },
];

describe("cross-surface tag editing integration (3.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(HOSTS)(
    "persists a $host edit via the shared adapter and reconciles the host view",
    async ({ type, id, tags }) => {
      const onTagsPersisted = vi.fn();
      const target: ItemTagTarget = { type, id, tags };
      mocks.persistItemTags.mockImplementation(async (_t: ItemTagTarget, next: string[]) => next);
      mocks.subscribeItemTagsUpdated.mockImplementation(() => () => {});

      render(<ItemTagEditor target={target} onTagsPersisted={onTagsPersisted} />);

      const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
      fireEvent.change(input, { target: { value: "newTag" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(mocks.persistItemTags).toHaveBeenCalledWith(target, [...tags, "newTag"])
      );
      // Persisted result reconciles the initiating surface.
      await waitFor(() => expect(onTagsPersisted).toHaveBeenCalledWith([...tags, "newTag"]));
      // Typed notification published so OTHER mounted consumers converge.
      await waitFor(() =>
        expect(mocks.publishItemTagsUpdated).toHaveBeenCalledWith({
          itemType: type,
          id,
          tags: [...tags, "newTag"],
        })
      );
    }
  );

  it("documents edits from a compact trigger also persist and reconcile", async () => {
    const onTagsPersisted = vi.fn();
    mocks.persistItemTags.mockImplementation(async (_t: ItemTagTarget, next: string[]) => next);
    render(
      <CompactTagEditor
        target={{ type: "document", id: "d-2", tags: ["a"] }}
        onTagsPersisted={onTagsPersisted}
      />
    );
    fireEvent.click(screen.getByLabelText("tagEditor.editTags"));
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.persistItemTags).toHaveBeenCalledWith(
        { type: "document", id: "d-2", tags: ["a"] },
        ["a", "b"]
      )
    );
    await waitFor(() => expect(onTagsPersisted).toHaveBeenCalledWith(["a", "b"]));
  });
});

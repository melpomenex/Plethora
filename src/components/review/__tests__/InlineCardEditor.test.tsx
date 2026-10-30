import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineCardEditor } from "../InlineCardEditor";
import { useToastStore, ToastType } from "../../common/Toast";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { LearningItem } from "../../../api/learning-items";
import { cardMutationCoordinator } from "../../../api/learningItemMutationCoordinator";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
}));

const { updateLearningItemContentWithVersion, updateLearningItemTags } = vi.hoisted(() => ({
  updateLearningItemContentWithVersion: vi.fn(),
  updateLearningItemTags: vi.fn(),
}));

vi.mock("../../../api/learning-items", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    updateLearningItemContentWithVersion,
    updateLearningItemTags,
  };
});

const baseCard: LearningItem = {
  id: "card-1",
  item_type: "Basic",
  question: "Capital of France?",
  answer: "Paris",
  difficulty: 3,
  interval: 1,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 2,
  lapses: 0,
  state: "Review",
  is_suspended: false,
  tags: ["geo"],
};

beforeEach(() => {
  vi.clearAllMocks();
  cardMutationCoordinator.resetForTesting();
  useToastStore.setState({ toasts: [] });
  updateLearningItemContentWithVersion.mockImplementation((input: any) => {
    if (typeof input === "string") {
      return Promise.resolve({ ...baseCard, id: input });
    }
    return Promise.resolve({
      ...baseCard,
      ...input,
      id: input.itemId,
      cloze_text: input.clozeText ?? input.cloze_text,
      cloze_ranges: input.clozeRanges ?? input.cloze_ranges,
      tags: input.tags ?? baseCard.tags,
    });
  });
  updateLearningItemTags.mockResolvedValue({ ...baseCard });
});

function toastTitles(): Array<{ type: ToastType; title: string }> {
  return useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title }));
}

describe("InlineCardEditor", () => {
  it("saves question and answer edits for a basic card", async () => {
    const onSave = vi.fn();
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue("Capital of France?"), {
      target: { value: "Capital of Italy?" },
    });
    fireEvent.change(screen.getByDisplayValue("Paris"), { target: { value: "Rome" } });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(updateLearningItemContentWithVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "card-1",
          question: "Capital of Italy?",
          answer: "Rome",
          reason: "Edited via Deck Manager",
        })
      )
    );
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: "Capital of Italy?", answer: "Rome" })
    );
  });

  it("records the review surface in the version reason", async () => {
    render(
      <InlineCardEditor
        card={baseCard}
        surface="review"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(updateLearningItemContentWithVersion).toHaveBeenCalled());
    expect(updateLearningItemContentWithVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "card-1",
        reason: "Edited during review",
      })
    );
  });

  it("records the queue surface in the version reason", async () => {
    render(
      <InlineCardEditor
        card={baseCard}
        surface="queue"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(updateLearningItemContentWithVersion).toHaveBeenCalled());
    expect(updateLearningItemContentWithVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "card-1",
        reason: "Edited in Queue",
      })
    );
  });

  it("edits cloze text and mirrors it into the question field", async () => {
    const clozeCard: LearningItem = {
      ...baseCard,
      item_type: "Cloze",
      question: "The {{c1::sun}} rises in the east.",
      answer: undefined,
      cloze_text: "The {{c1::sun}} rises in the east.",
    };
    const onSave = vi.fn();
    render(<InlineCardEditor card={clozeCard} onClose={vi.fn()} onSave={onSave} />);

    const textarea = screen.getByLabelText(/cloze text/i);
    fireEvent.change(textarea, { target: { value: "The {{c1::moon}} rises at night." } });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(updateLearningItemContentWithVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "card-1",
          question: "The {{c1::moon}} rises at night.",
          clozeText: "The {{c1::moon}} rises at night.",
          reason: "Edited via Deck Manager",
        })
      )
    );
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: "The {{c1::moon}} rises at night.",
        cloze_text: "The {{c1::moon}} rises at night.",
      })
    );
  });

  it("projects legacy cloze card with cloze_ranges to editable markup", () => {
    const legacyClozeCard: LearningItem = {
      ...baseCard,
      item_type: "Cloze",
      question: "The sun rises in the east.",
      answer: undefined,
      cloze_ranges: [[4, 7]],
    };
    render(<InlineCardEditor card={legacyClozeCard} onClose={vi.fn()} onSave={vi.fn()} />);
    const textarea = screen.getByLabelText(/cloze text/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("The {{c1::sun}} rises in the east.");
  });

  it("toggles real hidden and revealed cloze preview", () => {
    const clozeCard: LearningItem = {
      ...baseCard,
      item_type: "Cloze",
      question: "The {{c1::sun}} rises in the east.",
      cloze_text: "The {{c1::sun}} rises in the east.",
    };
    render(<InlineCardEditor card={clozeCard} onClose={vi.fn()} onSave={vi.fn()} />);
    const preview = screen.getByTestId("inline-card-editor-cloze-preview");
    expect(preview.textContent).toContain("[...]");

    const revealBtn = screen.getByTestId("inline-card-editor-preview-revealed");
    fireEvent.click(revealBtn);
    expect(preview.textContent).toContain("sun");

    const hideBtn = screen.getByTestId("inline-card-editor-preview-hidden");
    fireEvent.click(hideBtn);
    expect(preview.textContent).toContain("[...]");
  });

  it("inspects raw source with toggle", () => {
    const clozeCard: LearningItem = {
      ...baseCard,
      item_type: "Cloze",
      question: "The {{c1::sun}} rises in the east.",
      cloze_text: "The {{c1::sun}} rises in the east.",
    };
    render(<InlineCardEditor card={clozeCard} onClose={vi.fn()} onSave={vi.fn()} />);
    const toggleBtn = screen.getByTestId("inline-card-editor-toggle-raw");
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("inline-card-editor-raw-source").textContent).toContain("The {{c1::sun}} rises in the east.");
  });

  it("warns but still saves when the cloze text has no marker", async () => {
    const clozeCard: LearningItem = {
      ...baseCard,
      item_type: "Cloze",
      question: "The {{c1::sun}} rises in the east.",
      cloze_text: "The {{c1::sun}} rises in the east.",
    };
    render(<InlineCardEditor card={clozeCard} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/cloze text/i), {
      target: { value: "No marker anywhere" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(updateLearningItemContentWithVersion).toHaveBeenCalled()
    );
    const toasts = toastTitles();
    expect(toasts.some((t) => t.type === ToastType.Warning)).toBe(true);
  });

  it("persists tag changes atomically in single update", async () => {
    const onSave = vi.fn();
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue("geo"), {
      target: { value: "geo, capitals" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(updateLearningItemContentWithVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "card-1",
          tags: ["geo", "capitals"],
        })
      )
    );
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: ["geo", "capitals"] })
    );
  });

  it("preserves draft and displays error banner when save fails", async () => {
    updateLearningItemContentWithVersion.mockRejectedValue(new Error("Network timeout"));
    const onSave = vi.fn();
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={onSave} />);

    const questionInput = screen.getByDisplayValue("Capital of France?") as HTMLInputElement;
    fireEvent.change(questionInput, {
      target: { value: "Capital of Italy?" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(screen.getByTestId("inline-card-editor-save-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("inline-card-editor-save-error").textContent).toContain("Network timeout");
    expect(questionInput.value).toBe("Capital of Italy?");
    // Optimistic update was dispatched, then rolled back on error
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(baseCard);

    const toasts = toastTitles();
    expect(toasts.some((t) => t.type === ToastType.Error)).toBe(true);
  });

  it("triggers onEditInStudio handoff for complex types", () => {
    const complexCard: LearningItem = {
      ...baseCard,
      item_type: "Qa",
      interaction_metadata: { imageOcclusionAssetId: "image-1" },
    };
    const onStudio = vi.fn();
    render(<InlineCardEditor card={complexCard} onClose={vi.fn()} onSave={vi.fn()} onEditInStudio={onStudio} />);
    const studioBtn = screen.getByTestId("inline-card-editor-studio-btn");
    fireEvent.click(studioBtn);
    expect(onStudio).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" }));
  });
});

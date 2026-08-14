import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineCardEditor } from "../InlineCardEditor";
import { useToastStore, ToastType } from "../../common/Toast";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { LearningItem } from "../../../api/learning-items";

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
  useToastStore.setState({ toasts: [] });
  updateLearningItemContentWithVersion.mockResolvedValue({ ...baseCard });
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
        "card-1",
        "Capital of Italy?",
        "Rome",
        "Edited via Deck Manager",
        undefined,
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
      "card-1",
      expect.any(String),
      expect.anything(),
      "Edited during review",
      undefined,
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
        "card-1",
        "The {{c1::moon}} rises at night.",
        undefined,
        "Edited via Deck Manager",
        "The {{c1::moon}} rises at night.",
      )
    );
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: "The {{c1::moon}} rises at night.",
        cloze_text: "The {{c1::moon}} rises at night.",
      })
    );
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
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe(ToastType.Warning);
  });

  it("persists tag changes through the tag update path", async () => {
    const onSave = vi.fn();
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue("geo"), {
      target: { value: "geo, capitals" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(updateLearningItemTags).toHaveBeenCalled());
    expect(updateLearningItemTags).toHaveBeenCalledWith("card-1", ["geo", "capitals"]);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: ["geo", "capitals"] })
    );
  });

  it("does not hit the tag path when tags are unchanged", async () => {
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(updateLearningItemContentWithVersion).toHaveBeenCalled()
    );
    expect(updateLearningItemTags).not.toHaveBeenCalled();
  });

  it("rolls the card back when the save fails", async () => {
    updateLearningItemContentWithVersion.mockRejectedValue(new Error("boom"));
    const onSave = vi.fn();
    render(<InlineCardEditor card={baseCard} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue("Capital of France?"), {
      target: { value: "Capital of Italy?" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    // Optimistic update first, then the rollback to the original card.
    expect(onSave).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ question: "Capital of Italy?" })
    );
    expect(onSave).toHaveBeenLastCalledWith(baseCard);
    const toasts = toastTitles();
    expect(toasts.some((t) => t.type === ToastType.Error)).toBe(true);
  });
});

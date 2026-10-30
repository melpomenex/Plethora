import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewCardContent } from "../ReviewCardContent";
import type { LearningItem } from "../../../api/learning-items";
import { getImageAssetById } from "../../../api/image-registry";
import { getSafeCardPromptSummary, getSafeCardSpeechText } from "../../../utils/cloze";

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: vi.fn(),
}));

const baseItem: LearningItem = {
  id: "card-parity-1",
  document_id: "doc-1",
  extract_id: "extract-1",
  item_type: "Basic",
  question: "What is the capital of France?",
  answer: "Paris",
  cloze_text: null,
  cloze_ranges: null,
  difficulty: 3,
  interval: 1,
  ease_factor: 2.5,
  due_date: "2026-10-29T12:00:00Z",
  date_created: "2026-10-29T12:00:00Z",
  date_modified: "2026-10-29T12:00:00Z",
  review_count: 0,
  lapses: 0,
  state: "New",
  is_suspended: false,
  tags: ["geography"],
};

describe("ReviewCardContent Parity and Safe Presentation", () => {
  it("renders basic card: question only when unrevealed, answer when revealed", () => {
    const { container, rerender } = render(
      <ReviewCardContent card={baseItem} showAnswer={false} part="both" />
    );

    expect(container.textContent).toContain("What is the capital of France?");
    expect(container.textContent).not.toContain("Paris");
    expect(screen.queryByTestId("card-answer-content")).not.toBeInTheDocument();

    rerender(<ReviewCardContent card={baseItem} showAnswer={true} part="both" />);
    expect(container.textContent).toContain("What is the capital of France?");
    expect(container.textContent).toContain("Paris");
    expect(screen.getByTestId("card-answer-content")).toBeInTheDocument();
  });

  it("renders cloze card without hidden answer leaks before reveal", () => {
    const clozeItem: LearningItem = {
      ...baseItem,
      item_type: "Cloze",
      question: "The {{c1::mitochondria::cell organelle}} generates ATP.",
      cloze_text: "The {{c1::mitochondria::cell organelle}} generates ATP.",
    };

    const { container, rerender } = render(
      <ReviewCardContent card={clozeItem} showAnswer={false} part="both" />
    );

    // Answer "mitochondria" MUST NOT be in the DOM
    expect(container.textContent).not.toContain("mitochondria");
    // Hint "cell organelle" is shown
    expect(container.textContent).toContain("cell organelle");
    // Markers are stripped
    expect(container.textContent).not.toContain("{{c1::");
    expect(screen.getByTestId("cloze-blank")).toHaveAttribute("data-cloze-state", "hidden");

    // Reveal
    rerender(<ReviewCardContent card={clozeItem} showAnswer={true} part="both" />);
    expect(container.textContent).toContain("mitochondria");
    expect(container.textContent).not.toContain("{{c1::");
    expect(screen.getByTestId("cloze-revealed")).toHaveAttribute("data-cloze-state", "revealed");
  });

  it("renders repair state for malformed cloze without leaking content", () => {
    const malformedItem: LearningItem = {
      ...baseItem,
      item_type: "Cloze",
      question: "Malformed {{c1::unclosed marker without bracket",
    };

    render(<ReviewCardContent card={malformedItem} showAnswer={false} part="both" />);
    expect(screen.getByTestId("cloze-repair-state")).toBeInTheDocument();
  });

  it("renders image occlusion shrink-wrapped frame and regions", async () => {
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-occ",
      mime_type: "image/png",
      byte_size: 1024,
      sha256: "hash123",
      created_at: "2026-10-29T12:00:00Z",
      data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });

    const occlusionItem: LearningItem = {
      ...baseItem,
      item_type: "Qa",
      image_asset_ids: ["asset-occ"],
      interaction_metadata: {
        imageOcclusionAssetId: "asset-occ",
        imageOcclusionRegions: [
          { id: "reg-1", x: 10, y: 10, width: 30, height: 20, label: "Heart" },
          { id: "reg-2", x: 50, y: 40, width: 25, height: 20, label: "Lungs" },
        ],
        targetRegionId: "reg-1",
        occlusionMode: "hide-all",
      },
    };

    const onToggle = vi.fn();
    const { rerender } = render(
      <ReviewCardContent
        card={occlusionItem}
        showAnswer={false}
        revealAllSiblings={false}
        onToggleRevealAllSiblings={onToggle}
        part="both"
      />
    );

    // Frame is shrink-wrapped
    const frame = await screen.findByTestId("occlusion-image-frame");
    expect(frame).toBeInTheDocument();

    // Overlays before reveal: all regions hidden in hide-all mode
    const overlays = screen.getAllByTestId("occlusion-region-overlay");
    expect(overlays).toHaveLength(2);
    expect(screen.getByTestId("occlusion-target-badge")).toBeInTheDocument();

    // Answer reveal
    rerender(
      <ReviewCardContent
        card={occlusionItem}
        showAnswer={true}
        revealAllSiblings={false}
        onToggleRevealAllSiblings={onToggle}
        part="both"
      />
    );

    // In hide-all mode after reveal: target is unmasked, sibling stays masked
    const remainingOverlays = screen.getAllByTestId("occlusion-region-overlay");
    expect(remainingOverlays).toHaveLength(1);
    expect(remainingOverlays[0]).toHaveAttribute("data-occlusion-target", "false");

    // Reveal all button exists
    const revealAllBtn = screen.getByTestId("occlusion-reveal-all");
    fireEvent.click(revealAllBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("renders repair state for invalid occlusion geometry", () => {
    const invalidOccItem: LearningItem = {
      ...baseItem,
      item_type: "Qa",
      interaction_metadata: {
        imageOcclusionRegions: [
          // Out of bounds: x + width = 120%
          { id: "reg-oob", x: 60, y: 10, width: 60, height: 20 },
        ],
      },
    };

    render(<ReviewCardContent card={invalidOccItem} showAnswer={false} part="both" />);
    expect(screen.getByTestId("occlusion-repair-state")).toBeInTheDocument();
  });

  it("renders missing asset fallback when asset load fails", async () => {
    vi.mocked(getImageAssetById).mockResolvedValueOnce(null as any);

    const missingAssetItem: LearningItem = {
      ...baseItem,
      item_type: "Qa",
      image_asset_ids: ["non-existent-asset"],
      interaction_metadata: {
        imageOcclusionRegions: [
          { id: "reg-1", x: 10, y: 10, width: 20, height: 20 },
        ],
      },
    };

    render(<ReviewCardContent card={missingAssetItem} showAnswer={false} part="both" />);
    expect(await screen.findByTestId("occlusion-missing-asset")).toBeInTheDocument();
  });

  it("verifies safe speech text never speaks cloze answers before reveal or says 'Cloze Deletion'", () => {
    const clozeItem: LearningItem = {
      ...baseItem,
      item_type: "Cloze",
      question: "The {{c1::secret answer::vital clue}} is tested.",
      cloze_text: "The {{c1::secret answer::vital clue}} is tested.",
    };

    const questionSpeech = getSafeCardSpeechText(clozeItem, "question");
    expect(questionSpeech.speakable).toBe(true);
    expect(questionSpeech.text).not.toContain("secret answer");
    expect(questionSpeech.text).toContain("blank (vital clue)");
    expect(questionSpeech.text).not.toContain("Cloze Deletion");

    const answerSpeech = getSafeCardSpeechText(clozeItem, "answer");
    expect(answerSpeech.speakable).toBe(true);
    expect(answerSpeech.text).toContain("secret answer");
  });

  it("verifies safe prompt summary never discloses hidden answer in unrevealed mode", () => {
    const clozeItem: LearningItem = {
      ...baseItem,
      item_type: "Cloze",
      question: "The {{c1::hydrogen}} atom has one proton.",
    };

    const summaryUnrevealed = getSafeCardPromptSummary(clozeItem, { revealed: false });
    expect(summaryUnrevealed).not.toContain("hydrogen");
    expect(summaryUnrevealed).toContain("[...]");

    const summaryRevealed = getSafeCardPromptSummary(clozeItem, { revealed: true });
    expect(summaryRevealed).toContain("hydrogen");
  });
});

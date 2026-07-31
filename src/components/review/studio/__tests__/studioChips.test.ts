import { describe, expect, it } from "vitest";
import {
  buildStudioChips,
  formatChipTokens,
  truncateChipLabel,
  type StudioChipState,
} from "../studioChips";
import { DEFAULT_CONTEXT_SELECTION } from "../contextSelection";

function state(overrides: Partial<StudioChipState> = {}): StudioChipState {
  return {
    documentTitle: "The Power of Neuroplasticity",
    deckName: "Neuroscience",
    deckTags: [],
    imageCount: 0,
    selectedImageCount: 0,
    contextSelection: DEFAULT_CONTEXT_SELECTION,
    contextTokens: 139,
    providerName: "OpenRouter",
    ...overrides,
  };
}

const byId = (chips: ReturnType<typeof buildStudioChips>, id: string) =>
  chips.find((chip) => chip.id === id);

describe("truncateChipLabel", () => {
  it("leaves labels within budget untouched", () => {
    expect(truncateChipLabel("Neuroscience")).toBe("Neuroscience");
  });

  it("truncates with an ellipsis past the budget", () => {
    expect(truncateChipLabel("The Power of Neuroplasticity")).toBe("The Power of Neuro…");
  });

  it("does not leave a space before the ellipsis", () => {
    // Budget lands mid-gap: "Memory and " would otherwise render "Memory and …".
    expect(truncateChipLabel("Memory and Recall", 11)).toBe("Memory and…");
  });

  it("honors a custom budget", () => {
    expect(truncateChipLabel("Neuroscience", 5)).toBe("Neuro…");
  });
});

describe("formatChipTokens", () => {
  it("renders counts under 1000 verbatim", () => {
    expect(formatChipTokens(139)).toBe("139");
    expect(formatChipTokens(0)).toBe("0");
  });

  it("abbreviates thousands to one decimal", () => {
    expect(formatChipTokens(1000)).toBe("1.0k");
    expect(formatChipTokens(12480)).toBe("12.5k");
  });
});

describe("buildStudioChips", () => {
  it("always renders document, deck, context, and provider chips", () => {
    const chips = buildStudioChips(state());
    expect(chips.map((chip) => chip.id)).toEqual([
      "document",
      "deck",
      "context",
      "provider",
    ]);
  });

  it("renders the document chip in an unset state with no document", () => {
    const chip = byId(buildStudioChips(state({ documentTitle: null })), "document");
    expect(chip?.active).toBe(false);
    expect(chip?.label).toBe("");
    expect(chip?.fullLabel).toBe("");
  });

  it("treats a whitespace-only document title as unset", () => {
    const chip = byId(buildStudioChips(state({ documentTitle: "   " })), "document");
    expect(chip?.active).toBe(false);
  });

  it("truncates a long document title but keeps the full value", () => {
    const chip = byId(buildStudioChips(state()), "document");
    expect(chip?.label).toBe("The Power of Neuro…");
    expect(chip?.fullLabel).toBe("The Power of Neuroplasticity");
    expect(chip?.active).toBe(true);
  });

  it("hides the tag chip when the deck has no tags", () => {
    expect(byId(buildStudioChips(state()), "tags")).toBeUndefined();
  });

  it("renders a display-only tag chip when the deck has tags", () => {
    const chips = buildStudioChips(state({ deckTags: ["neuro", "brain"] }));
    const chip = byId(chips, "tags");
    expect(chip?.fullLabel).toBe("neuro, brain");
    expect(chip?.opens).toBeNull();
  });

  it("hides the image chip when the registry is empty and nothing is selected", () => {
    expect(byId(buildStudioChips(state()), "images")).toBeUndefined();
  });

  it("shows the available image count when none are selected", () => {
    const chip = byId(buildStudioChips(state({ imageCount: 7 })), "images");
    expect(chip?.label).toBe("7");
    expect(chip?.active).toBe(false);
  });

  it("shows the selected image count and emphasizes the chip", () => {
    const chips = buildStudioChips(state({ imageCount: 7, selectedImageCount: 2 }));
    const chip = byId(chips, "images");
    expect(chip?.label).toBe("2");
    expect(chip?.active).toBe(true);
  });

  it("marks the context chip inactive for the default full-document selection", () => {
    const chip = byId(buildStudioChips(state()), "context");
    expect(chip?.active).toBe(false);
    expect(chip?.label).toBe("139");
  });

  it("marks the context chip active for a non-default selection", () => {
    const chips = buildStudioChips(state({
      contextSelection: { ...DEFAULT_CONTEXT_SELECTION, mode: "excerpt", excerpt: "..." },
    }));
    expect(byId(chips, "context")?.active).toBe(true);
  });

  it("normalizes a malformed context selection rather than throwing", () => {
    const chips = buildStudioChips(state({
      contextSelection: { mode: "nonsense" } as never,
    }));
    // Unknown modes fall back to "full", so the chip reads as default.
    expect(byId(chips, "context")?.active).toBe(false);
  });

  it("renders the provider chip in an unset state with no provider", () => {
    const chip = byId(buildStudioChips(state({ providerName: null })), "provider");
    expect(chip?.active).toBe(false);
    expect(chip?.label).toBe("");
  });

  it("gives every chip that opens a sheet a matching sheet key", () => {
    const chips = buildStudioChips(state({ imageCount: 3, deckTags: ["a"] }));
    for (const chip of chips) {
      if (chip.opens === null) continue;
      expect(chip.opens).toBe(chip.id);
    }
  });
});

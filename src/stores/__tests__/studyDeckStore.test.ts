import { beforeEach, describe, expect, it } from "vitest";
import { matchesDeck } from "../../utils/studyDecks";
import {
  migrateStudyDeckState,
  resolveStudyDeckFilterType,
  useStudyDeckStore,
} from "../studyDeckStore";

describe("studyDeckStore deck membership", () => {
  beforeEach(() => {
    localStorage.clear();
    useStudyDeckStore.setState({ decks: [], activeDeckIds: [] });
  });

  it("defaults an unbound named/tagged deck to tag filtering", () => {
    const id = useStudyDeckStore.getState().addDeck("Podcast Episode", ["Podcast Episode"]);
    const deck = useStudyDeckStore.getState().decks.find((candidate) => candidate.id === id)!;

    expect(deck.filterType).toBe("tags");
    expect(matchesDeck({ tags: ["deck:Podcast Episode"] }, deck)).toBe(true);
    expect(matchesDeck({ tags: ["Anki Import"] }, deck)).toBe(false);
    expect(matchesDeck({ tags: [] }, deck)).toBe(false);
  });

  it("keeps document-bound decks scoped by document ownership", () => {
    expect(resolveStudyDeckFilterType(["Book"], "doc-1")).toBe("all");
    const id = useStudyDeckStore.getState().addDeck("Book", ["Book"], "doc-1");
    const deck = useStudyDeckStore.getState().decks.find((candidate) => candidate.id === id)!;

    expect(matchesDeck({ tags: [], document_id: "doc-1" }, deck)).toBe(true);
    expect(matchesDeck({ tags: ["Book"], document_id: "doc-2" }, deck)).toBe(false);
  });

  it("preserves explicit smart/global filter choices", () => {
    const allId = useStudyDeckStore.getState().addDeck("Everything", [], undefined, "all");
    const cramId = useStudyDeckStore.getState().addDeck("Cram", ["biology"], undefined, "cram");
    useStudyDeckStore.getState().addDeck("Cram", ["extra"]);

    const allDeck = useStudyDeckStore.getState().decks.find((deck) => deck.id === allId)!;
    const cramDeck = useStudyDeckStore.getState().decks.find((deck) => deck.id === cramId)!;
    expect(allDeck.filterType).toBe("all");
    expect(cramDeck).toMatchObject({ filterType: "cram", tagFilters: ["biology", "extra"] });
  });

  it("repairs an existing all-library deck when Anki reconciliation supplies its tag", () => {
    useStudyDeckStore.setState({
      decks: [{
        id: "legacy",
        name: "Imported Anatomy",
        tagFilters: ["Imported Anatomy"],
        filterType: "all",
      }],
      activeDeckIds: [],
    });

    useStudyDeckStore.getState().ensureDecksExist(["Imported Anatomy"]);

    expect(useStudyDeckStore.getState().decks[0]).toMatchObject({
      name: "Imported Anatomy",
      tagFilters: ["Imported Anatomy"],
      filterType: "tags",
    });
  });

  it("does not replace an intentional smart deck on an imported name collision", () => {
    const id = useStudyDeckStore.getState().addDeck(
      "Imported Anatomy",
      ["hard"],
      undefined,
      "difficulty",
      [3, 4],
    );

    expect(useStudyDeckStore.getState().ensureDecksExist(["Imported Anatomy"])).toEqual([id]);
    expect(useStudyDeckStore.getState().decks[0]).toMatchObject({
      tagFilters: ["hard"],
      filterType: "difficulty",
      difficultyFilters: [3, 4],
    });
  });

  it("migrates only unbound tagged all-library decks to tag filtering", () => {
    const migrated = migrateStudyDeckState({
      decks: [
        { id: "bad", name: "Bad", tagFilters: ["Bad"], filterType: "all" },
        { id: "doc", name: "Book", tagFilters: ["Book"], documentId: "doc-1", filterType: "all" },
        { id: "global", name: "Everything", tagFilters: [], filterType: "all" },
      ],
      activeDeckIds: [],
    }, 2);

    expect(migrated.decks).toEqual([
      { id: "bad", name: "Bad", tagFilters: ["Bad"], filterType: "tags" },
      { id: "doc", name: "Book", tagFilters: ["Book"], documentId: "doc-1", filterType: "all" },
      { id: "global", name: "Everything", tagFilters: [], filterType: "all" },
    ]);
  });
});

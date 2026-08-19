import { useState, useEffect, useMemo } from "react";
import {
  ArrowsClockwise,
  Brain,
  Eye,
  EyeSlash,
  FloppyDisk,
  Pencil,
  Trash,
  X,
  Tag,
  Flame,
  Gauge,
  Folder,
} from "@phosphor-icons/react";
import {
  getLearningItems,
  type LearningItem,
  getItemTypeName,
  getItemStateName,
  getLearningItemVersions,
  getLearningItemPrerequisites,
  revertLearningItemVersion,
  setLearningItemPrerequisites,
  updateLearningItemContentWithVersion,
} from "../../api/learning-items";
import { useReviewStore } from "../../stores/reviewStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { ReviewTab } from "../tabs/TabRegistry";
import { cn } from "../../utils";
import { DynamicVirtualList } from "../common/VirtualList";
import { CompactTagEditor } from "../common/CompactTagEditor";
import { renderAnkiHtmlWithLatex, warmAnkiLatexNormalization } from "../../utils/ankiLatex";
import { analyzeCardQuality } from "../../utils/cardQuality";
import { printFlashcards } from "../../utils/printFlashcards";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { getDocument } from "../../api/documents";
import { useUndoableOperations } from "../../api/undoable";

interface LearningCardsListProps {
  documentId: string;
}

export function LearningCardsList({ documentId }: LearningCardsListProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { deleteLearningItem } = useUndoableOperations();
  const [cards, setCards] = useState<LearningItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState<Record<string, boolean>>({});
  const [qualityByCard, setQualityByCard] = useState<Record<string, ReturnType<typeof analyzeCardQuality>>>({});
  const [prereqByCard, setPrereqByCard] = useState<Record<string, string[]>>({});
  const [deletingCardIds, setDeletingCardIds] = useState<Set<string>>(new Set());

  // Custom Save as Smart Deck Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckType, setDeckType] = useState<"all" | "tags" | "cram" | "difficulty">("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<number[]>([4, 5]);

  const docTags = useMemo(() => {
    const tags = new Set<string>();
    for (const card of cards) {
      if (card.tags) {
        for (const tag of card.tags) {
          if (tag.trim()) tags.add(tag.trim());
        }
      }
    }
    return Array.from(tags);
  }, [cards]);

  const handleOpenSaveModal = async () => {
    const doc = await getDocument(documentId);
    setDeckName(doc?.title || "New Deck");
    setDeckType("all");
    setSelectedTags(docTags);
    setSelectedDifficulties([4, 5]);
    setIsModalOpen(true);
  };

  const handleSaveDeck = () => {
    const trimmedName = deckName.trim();
    if (!trimmedName) {
      toast.error("Deck name cannot be empty");
      return;
    }

    let tagFilters: string[] = [];
    if (deckType === "tags") {
      tagFilters = selectedTags;
      if (tagFilters.length === 0) {
        toast.error("Please select at least one tag");
        return;
      }
    }

    const deckId = useStudyDeckStore.getState().addDeck(
      trimmedName,
      tagFilters,
      documentId,
      deckType,
      deckType === "difficulty" ? selectedDifficulties : [],
      []
    );

    toast.success(`Deck "${trimmedName}" created successfully!`);
    setIsModalOpen(false);

    // Select the deck in the review store and open the deck manager view
    useReviewStore.getState().setSelectedDeckId(deckId);
    useReviewStore.getState().setReviewTabMode("deck-manager");

    useTabsStore.getState().addTab({
      title: t("learningCards.studyNow"),
      icon: "🧠",
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getLearningItems(documentId)
      .then((data) => {
        if (!cancelled) {
          setCards(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load cards");
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;
    const loadPrerequisites = async () => {
      const entries = await Promise.all(
        cards.map(async (card) => [card.id, await getLearningItemPrerequisites(card.id)] as const)
      );
      if (!cancelled) {
        setPrereqByCard(Object.fromEntries(entries));
      }
    };
    if (cards.length > 0) {
      void loadPrerequisites();
    }
    return () => {
      cancelled = true;
    };
  }, [cards]);

  useEffect(() => {
    for (const card of cards) {
      warmAnkiLatexNormalization([card.question, card.answer, card.cloze_text]);
    }
  }, [cards]);

  const toggleAnswer = (cardId: string) => {
    setShowAnswers(prev => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  };

  const getCardTypeColor = (itemType: LearningItem["item_type"]) => {
    switch (itemType) {
      case "Cloze":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "Qa":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "Flashcard":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const getDifficultyColor = (difficulty: number) => {
    if (difficulty <= 2) return "text-green-500";
    if (difficulty <= 4) return "text-yellow-500";
    return "text-red-500";
  };

  const updateCardInState = (next: LearningItem) => {
    setCards((current) => current.map((card) => (card.id === next.id ? next : card)));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">{t("learningCards.loadingCards")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">
        {t("learningCards.failedLoadCards")}: {error}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="text-center py-12">
        <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("learningCards.noCardsYet")}
        </h3>
        <p className="text-muted-foreground">
          {t("learningCards.generateCardsDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="text-2xl font-bold text-foreground">
          {t("learningCards.cards", { count: cards.length })}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => printFlashcards(cards, `Flashcards (${cards.length})`)}
            className="px-3 py-1.5 text-sm border border-border text-foreground rounded-md hover:bg-muted transition-colors"
          >
            {t("learningCards.print")}
          </button>
          <button
            onClick={handleOpenSaveModal}
            className="px-3 py-1.5 text-sm border border-border text-foreground rounded-md hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <FloppyDisk className="w-3.5 h-3.5" />
            {t("learningCards.saveAsDeck")}
          </button>
          <button
            onClick={async () => {
              await useReviewStore.getState().studyDocumentCards(documentId);
              const { queue } = useReviewStore.getState();
              if (queue.length > 0) {
                useTabsStore.getState().addTab({
                  title: t("learningCards.studyNow"),
                  icon: "🧠",
                  type: "review",
                  content: ReviewTab,
                  closable: true,
                });
              }
            }}
            disabled={cards.length === 0}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {t("learningCards.studyNow")}
          </button>
        </div>
      </div>

      {/* Virtual Scrolled Cards List */}
      <DynamicVirtualList
        items={cards}
        renderItem={(card) => (
          <div className="p-4 mb-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <span
                  className={cn(
                    "px-2 py-0.5 text-xs rounded border",
                    getCardTypeColor(card.item_type)
                  )}
                >
                  {getItemTypeName(card.item_type)}
                </span>
                <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                  {getItemStateName(card.state)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const nextQuestion = prompt("Edit question", card.question);
                    if (nextQuestion === null || !nextQuestion.trim()) return;
                    const nextAnswer = prompt("Edit answer", card.answer || "") ?? "";
                    const reason = prompt("Reason for edit (optional)") || undefined;
                    const updated = await updateLearningItemContentWithVersion(
                      card.id,
                      nextQuestion.trim(),
                      nextAnswer.trim(),
                      reason
                    );
                    updateCardInState(updated);
                    toast.success("Card updated");
                  }}
                  className="p-1.5 rounded hover:bg-muted transition-colors"
                  title={t("learningCards.editCard")}
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={async () => {
                    const versions = await getLearningItemVersions(card.id);
                    if (versions.length === 0) {
                      toast.info("No revision history for this card yet.");
                      return;
                    }
                    const choices = versions
                      .slice(0, 8)
                      .map((version, index) => {
                        const date = new Date(version.timestamp).toLocaleString();
                        const reason = version.reason ? ` - ${version.reason}` : "";
                        return `${index + 1}. ${date}${reason}`;
                      })
                      .join("\n");
                    const selection = prompt(
                      `Select revision number to revert:\n${choices}`,
                      "1"
                    );
                    if (!selection) return;
                    const selected = versions[Number(selection) - 1];
                    if (!selected) return;
                    const reverted = await revertLearningItemVersion(card.id, selected.version_id);
                    updateCardInState(reverted);
                    toast.success("Card reverted to selected revision");
                  }}
                  className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-muted"
                  title={t("learningCards.versionHistory")}
                >
                  {t("learningCards.history")}
                </button>
                <button
                  onClick={async () => {
                    const current = prereqByCard[card.id] || [];
                    const nextValue = prompt(
                      t("learningCards.prerequisites"),
                      current.join(",")
                    );
                    if (nextValue === null) return;
                    const prerequisites = nextValue
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean);
                    await setLearningItemPrerequisites(card.id, prerequisites);
                    setPrereqByCard((state) => ({ ...state, [card.id]: prerequisites }));
                    toast.success("Prerequisites updated");
                  }}
                  className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-muted"
                  title={t("learningCards.prerequisites")}
                >
                  {t("learningCards.prereq")}
                </button>
                <button
                  onClick={() =>
                    setQualityByCard((current) => ({
                      ...current,
                      [card.id]: analyzeCardQuality(card.question || "", card.answer || ""),
                    }))
                  }
                  className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-muted"
                  title={t("learningCards.analyzeQuality")}
                >
                  {t("learningCards.analyze")}
                </button>
                <button
                  onClick={async () => {
                    if (deletingCardIds.has(card.id)) return;
                    setDeletingCardIds((current) => new Set(current).add(card.id));
                    try {
                      await deleteLearningItem(card.id, () => {
                        setCards((current) => current.filter((item) => item.id !== card.id));
                        setPrereqByCard((current) => {
                          const next = { ...current };
                          delete next[card.id];
                          return next;
                        });
                      });
                    } catch {
                      // The undoable operation owns success and error notifications.
                    } finally {
                      setDeletingCardIds((current) => {
                        const next = new Set(current);
                        next.delete(card.id);
                        return next;
                      });
                    }
                  }}
                  disabled={deletingCardIds.has(card.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  title={t("learningCards.deleteCard")}
                >
                  <Trash className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            </div>

            {/* Question */}
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">
                {t("learningCards.question")}
              </div>
              <div 
                className="text-foreground" 
                dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.question) }} 
              />
            </div>

            {/* Answer */}
            {card.answer && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("learningCards.answer")}
                  </div>
                  <button
                    onClick={() => toggleAnswer(card.id)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAnswers[card.id] ? (
                      <span className="flex items-center gap-1">
                        <EyeSlash className="w-3 h-3" /> {t("learningCards.hide")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" /> {t("learningCards.show")}
                      </span>
                    )}
                  </button>
                </div>
                {showAnswers[card.id] ? (
                  <div 
                    className="text-foreground p-3 bg-muted rounded-md" 
                    dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.answer) }} 
                  />
                ) : (
                  <p className="text-muted-foreground italic text-sm">
                    {t("learningCards.answerHidden")}
                  </p>
                )}
              </div>
            )}

            {/* Stats Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span>
                  Due: {new Date(card.due_date).toLocaleDateString()}
                </span>
                <span className={cn("font-medium", getDifficultyColor(card.difficulty))}>
                  Difficulty: {card.difficulty}/10
                </span>
                <span>Interval: {card.interval}d</span>
                {card.review_count > 0 && (
                  <span>Reviews: {card.review_count}</span>
                )}
              </div>

              {card.ease_factor != null && card.ease_factor !== 2.5 && (
                <span className="flex items-center gap-1">
                  <ArrowsClockwise className="w-3 h-3" />
                  EF: {card.ease_factor.toFixed(2)}
                </span>
              )}
            </div>

            {/* Tags */}
            {card.tags.length > 0 && (
              <div className="mt-2">
                <CompactTagEditor
                  target={{ type: "learning-item", id: card.id, tags: card.tags }}
                  previewLimit={3}
                />
              </div>
            )}
            {prereqByCard[card.id]?.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Prerequisites: {prereqByCard[card.id].join(", ")}
              </p>
            ) : null}

            {qualityByCard[card.id] && (
              <div className="mt-3 rounded border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-foreground">
                  Quality score: {qualityByCard[card.id].score}/100
                </p>
                {qualityByCard[card.id].issues.length > 0 && (
                  <p className="mt-1 text-xs text-orange-500">
                    {qualityByCard[card.id].issues[0]}
                  </p>
                )}
                {qualityByCard[card.id].suggestions.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Suggestion: {qualityByCard[card.id].suggestions[0]}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        className="flex-1"
        estimateSize={280}
      />

      {/* Save as Smart Deck Custom Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">Save as Smart Deck</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-muted text-muted-foreground rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Input Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Deck Name
              </label>
              <input
                type="text"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                className="w-full bg-background border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none transition-colors"
                placeholder="Enter deck name..."
              />
            </div>

            {/* Smart Deck Types */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                Select Smart Deck Strategy
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Option 1: All Cards */}
                <button
                  onClick={() => setDeckType("all")}
                  className={cn(
                    "flex items-start gap-3 p-3 border rounded-xl text-left transition-all hover:bg-muted/50",
                    deckType === "all"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card"
                  )}
                >
                  <Folder className={cn("w-5.5 h-5.5 mt-0.5", deckType === "all" ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="text-sm font-semibold text-foreground">All Document Cards</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Includes all current and future cards of this document.</div>
                  </div>
                </button>

                {/* Option 2: Tag Filtered */}
                <button
                  onClick={() => setDeckType("tags")}
                  className={cn(
                    "flex items-start gap-3 p-3 border rounded-xl text-left transition-all hover:bg-muted/50",
                    deckType === "tags"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card"
                  )}
                >
                  <Tag className={cn("w-5.5 h-5.5 mt-0.5", deckType === "tags" ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="text-sm font-semibold text-foreground">Tag Filtered</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Focus only on cards matching specific tags/topics.</div>
                  </div>
                </button>

                {/* Option 3: Cram / Priority */}
                <button
                  onClick={() => setDeckType("cram")}
                  className={cn(
                    "flex items-start gap-3 p-3 border rounded-xl text-left transition-all hover:bg-muted/50",
                    deckType === "cram"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card"
                  )}
                >
                  <Flame className={cn("w-5.5 h-5.5 mt-0.5", deckType === "cram" ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="text-sm font-semibold text-foreground">Cram / High Priority</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Includes only due, new, learning, or lapsed cards.</div>
                  </div>
                </button>

                {/* Option 4: Difficulty Focused */}
                <button
                  onClick={() => setDeckType("difficulty")}
                  className={cn(
                    "flex items-start gap-3 p-3 border rounded-xl text-left transition-all hover:bg-muted/50",
                    deckType === "difficulty"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card"
                  )}
                >
                  <Gauge className={cn("w-5.5 h-5.5 mt-0.5", deckType === "difficulty" ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="text-sm font-semibold text-foreground">Difficulty Focused</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Filter by card complexity or review difficulty level.</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Custom Condition Panels */}
            {deckType === "tags" && (
              <div className="border border-border rounded-xl p-4 bg-muted/20 space-y-2 animate-in slide-in-from-top-2 duration-200">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Select Tags to Include ({selectedTags.length})
                </label>
                {docTags.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No tags found on this document's cards.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto pr-1">
                    {docTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => {
                            setSelectedTags((prev) =>
                              isSelected ? prev.filter((t) => t !== tag) : [...prev, tag]
                            );
                          }}
                          className={cn(
                            "px-2.5 py-1 text-xs border rounded-full transition-all flex items-center gap-1",
                            isSelected
                              ? "bg-primary border-primary text-primary-foreground font-medium"
                              : "bg-background border-border text-muted-foreground hover:border-muted-foreground"
                          )}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {deckType === "difficulty" && (
              <div className="border border-border rounded-xl p-4 bg-muted/20 space-y-2 animate-in slide-in-from-top-2 duration-200">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Select Difficulty Levels
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((lvl) => {
                    const isSelected = selectedDifficulties.includes(lvl);
                    const lvlLabel = lvl <= 2 ? "Easy" : lvl <= 4 ? "Medium" : "Hard";
                    return (
                      <button
                        key={lvl}
                        onClick={() => {
                          setSelectedDifficulties((prev) =>
                            isSelected ? prev.filter((d) => d !== lvl) : [...prev, lvl]
                          );
                        }}
                        className={cn(
                          "flex-1 py-2 border rounded-lg text-center transition-all flex flex-col items-center justify-center",
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground font-semibold shadow-sm"
                            : "bg-background border-border text-muted-foreground hover:border-muted-foreground"
                        )}
                      >
                        <span className="text-sm">{lvl}/5</span>
                        <span className="text-[10px] opacity-80">{lvlLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-border text-foreground hover:bg-muted text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDeck}
                className="px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 text-sm font-semibold rounded-lg transition-opacity flex items-center gap-1.5"
              >
                <FloppyDisk className="w-4 h-4" />
                Create Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

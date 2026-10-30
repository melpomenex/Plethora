import { useState, useCallback, useMemo } from "react";
import {
  ArrowSquareOut,
  Check,
  CircleNotch,
  Play,
  Prohibit,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import {
  type LearningItem,
} from "../../api/learning-items";
import { cardMutationCoordinator } from "../../api/learningItemMutationCoordinator";
import { bulkSuspendItems, bulkUnsuspendItems } from "../../api/queue";
import { sanitizeHtml } from "../common/RichContentRenderer";
import {
  hasRawClozeSyntax,
  projectClozeCardToEditableMarkup,
  evaluateClozeCard,
  renderClozeSegmentsHtml,
} from "../../utils/cloze";

interface InlineCardEditorProps {
  card: LearningItem;
  onClose: () => void;
  onSave: (updated: LearningItem) => void;
  /** Called after a successful persist (e.g. the review session closes the overlay). */
  onSaved?: () => void;
  onEditInStudio?: (card: LearningItem) => void;
  /** Which surface opened the editor; recorded in the version-history reason. */
  surface?: "deck-manager" | "review" | "queue";
}

/** Both marker syntaxes the cloze renderer accepts: {{c1::...}} and [[c1::...]]. */
function containsClozeMarker(text: string): boolean {
  return hasRawClozeSyntax(text) || /\[\[c\d+::/.test(text);
}

export function InlineCardEditor({
  card,
  onClose,
  onSave,
  onSaved,
  onEditInStudio,
  surface = "deck-manager",
}: InlineCardEditorProps) {
  const { t } = useI18n();
  const toast = useToast();

  // Desktop serializes interaction_metadata; the browser backend camel-cases
  // it. Either spelling marks a complex interaction type.
  const interactionMetadata = (card as any).interaction_metadata ?? (card as any).interactionMetadata;
  const isComplexType = Boolean(
    interactionMetadata?.interactionType ||
    interactionMetadata?.imageOcclusionAssetId ||
    (!["basic", "cloze"].includes(((card.item_type ?? (card as any).itemType) ?? "").toLowerCase()) && (card.item_type ?? (card as any).itemType))
  );

  // Item type casing varies by source (Rust serializes lowercase snake_case,
  // the browser backend camel-cases); match either, like ReviewCard does.
  const itemType = (card.item_type ?? (card as any).itemType) ?? "";
  const isCloze = itemType.toLowerCase() === "cloze";

  // Lossless range-to-markup editing projection for cloze cards
  const projection = useMemo(() => {
    if (!isCloze) return null;
    return projectClozeCardToEditableMarkup(card);
  }, [card, isCloze]);

  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer ?? "");
  const [clozeText, setClozeText] = useState(() => {
    if (isCloze && projection) {
      return projection.markup;
    }
    return card.cloze_text ?? card.question ?? "";
  });
  const [showRawSource, setShowRawSource] = useState(false);
  const [previewMode, setPreviewMode] = useState<"hidden" | "revealed">("hidden");
  const [tags, setTags] = useState(card.tags ? card.tags.join(", ") : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(card.is_suspended);

  // Real hidden/revealed evaluation for preview and range reconciliation
  const clozeEvaluation = useMemo(() => {
    if (!isCloze) return null;
    return evaluateClozeCard({ item_type: "Cloze", cloze_text: clozeText });
  }, [isCloze, clozeText]);

  const previewHtml = useMemo(() => {
    if (!isCloze) return "";
    if (!clozeEvaluation || clozeEvaluation.status === "repair_required") {
      return "";
    }
    return renderClozeSegmentsHtml(clozeEvaluation, previewMode === "revealed");
  }, [isCloze, clozeEvaluation, previewMode]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const prevCard = { ...card };

    const newTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Cloze saves edit the raw cloze markup and mirror it into `question`,
    // matching the `question || cloze_text` fallback consumers rely on.
    const effectiveQuestion = isCloze ? clozeText : question;
    const effectiveAnswer = isCloze ? card.answer : answer;

    // Range reconciliation on cloze edit
    let reconciledRanges: [number, number][] | undefined = undefined;
    if (isCloze) {
      if (clozeEvaluation?.status === "valid") {
        reconciledRanges = clozeEvaluation.deletions.map((d) => [d.start, d.end]);
      } else {
        reconciledRanges = [];
      }
    }

    const optimistic: LearningItem = {
      ...card,
      question: effectiveQuestion,
      answer: effectiveAnswer,
      tags: newTags,
      ...(isCloze ? { cloze_text: clozeText, cloze_ranges: reconciledRanges } : {}),
    };

    onSave(optimistic);

    try {
      const canonical = await cardMutationCoordinator.mutateLearningItemContent({
        itemId: card.id,
        question: effectiveQuestion,
        answer: effectiveAnswer,
        reason:
          surface === "review"
            ? "Edited during review"
            : surface === "queue"
              ? "Edited in Queue"
              : "Edited via Deck Manager",
        clozeText: isCloze ? clozeText : undefined,
        clozeRanges: isCloze ? reconciledRanges : undefined,
        tags: newTags,
      });

      onSave(canonical);

      if (isCloze && !containsClozeMarker(clozeText)) {
        // Mirrors Anki's tolerance: the save goes through, but warns that no marker is present
        toast.warning(t("reviewSession.clozeNoMarkerWarning"));
      } else {
        toast.success(t("review.deckManager.saved"));
      }
      onSaved?.();
    } catch (err) {
      // Preserve draft in state, roll back session item, and offer retry
      onSave(prevCard);
      const msg = err instanceof Error ? err.message : t("review.deckManager.saveError");
      setSaveError(msg);
      toast.error(t("review.deckManager.saveError"));
    } finally {
      setSaving(false);
    }
  }, [card, question, answer, clozeText, tags, isCloze, surface, clozeEvaluation, onSave, onSaved, toast, t]);

  const handleSuspendToggle = useCallback(async () => {
    const newState = !isSuspended;
    setIsSuspended(newState);

    try {
      if (newState) {
        await bulkSuspendItems([card.id]);
      } else {
        await bulkUnsuspendItems([card.id]);
      }
      onSave({ ...card, is_suspended: newState });
      toast.success(
        newState
          ? t("review.deckManager.suspended")
          : t("review.deckManager.unsuspended")
      );
    } catch {
      setIsSuspended(!newState);
      toast.error(t("review.deckManager.saveError"));
    }
  }, [card, isSuspended, onSave, toast, t]);

  return (
    <div data-testid="inline-card-editor" className="border-t border-border bg-muted/30 p-4 space-y-3">
      {isComplexType ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{card.item_type}</span>
            <span>·</span>
            <span>{t("review.deckManager.complexType")}</span>
          </div>
          <div className="text-sm">
            <div className="text-muted-foreground mb-1">
              {t("review.question")}:
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(card.question) }}
            />
          </div>
          <button
            data-testid="inline-card-editor-studio-btn"
            onClick={() => onEditInStudio?.(card)}
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowSquareOut className="h-3.5 w-3.5" />
            {t("review.deckManager.editInStudio")}
          </button>
        </div>
      ) : (
        <>
          {isCloze ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="inline-card-editor-cloze"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  {t("reviewSession.clozeTextLabel")}
                </label>
                {projection?.origin === "ranges" && (
                  <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {projection.lossless ? "Reconstructed from ranges" : "Raw range fallback"}
                  </span>
                )}
              </div>
              <textarea
                id="inline-card-editor-cloze"
                value={clozeText}
                onChange={(e) => setClozeText(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px] resize-y font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
                rows={4}
              />

              {/* Raw source inspection/toggle when available */}
              {projection?.rawSource && (
                <div className="space-y-1">
                  <div className="text-xs flex items-center justify-between text-muted-foreground">
                    <span className="text-[11px]">Underlying stored text:</span>
                    <button
                      type="button"
                      data-testid="inline-card-editor-toggle-raw"
                      onClick={() => setShowRawSource((prev) => !prev)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showRawSource ? "Hide raw source" : "View raw source"}
                    </button>
                  </div>
                  {showRawSource && (
                    <div
                      data-testid="inline-card-editor-raw-source"
                      className="p-2 rounded bg-muted text-xs font-mono whitespace-pre-wrap break-words border border-border"
                    >
                      {projection.rawSource}
                    </div>
                  )}
                </div>
              )}

              {/* Real hidden/revealed cloze preview */}
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("review.preview")}
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    data-testid="inline-card-editor-preview-hidden"
                    onClick={() => setPreviewMode("hidden")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      previewMode === "hidden"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    Hidden
                  </button>
                  <button
                    type="button"
                    data-testid="inline-card-editor-preview-revealed"
                    onClick={() => setPreviewMode("revealed")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      previewMode === "revealed"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    Revealed
                  </button>
                </div>
              </div>

              {clozeEvaluation?.status === "repair_required" ? (
                <div
                  data-testid="inline-card-editor-repair-warning"
                  className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2"
                >
                  <Warning className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Cloze repair required</div>
                    <div className="mt-0.5">{clozeEvaluation.message}</div>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="inline-card-editor-cloze-preview"
                  className="text-sm p-3 rounded-md bg-background border border-border prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("review.question")}
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("review.answer")}
                </label>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={2}
                />
              </div>
            </>
          )}
        </>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tags
        </label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="tag1, tag2, tag3"
        />
      </div>

      {saveError && (
        <div
          data-testid="inline-card-editor-save-error"
          className="p-2.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between"
        >
          <span>{saveError}</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs underline font-medium hover:opacity-80 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSuspendToggle}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors ${
              isSuspended
                ? "border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {isSuspended ? (
              <>
                <Play className="h-3 w-3" /> Unsuspend
              </>
            ) : (
              <>
                <Prohibit className="h-3 w-3" /> Suspend
              </>
            )}
          </button>
          {card.review_count > 0 && (
            <span className="text-xs text-muted-foreground">
              {card.review_count} reviews · {card.lapses} lapses
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          >
            <X className="h-3 w-3" />
            {t("review.deckManager.cancel")}
          </button>
          {!isComplexType && (
            <button
              onClick={handleSave}
              disabled={saving}
              data-testid="inline-card-editor-save"
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <CircleNotch className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {t("review.deckManager.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

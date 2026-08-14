import { useState, useCallback } from "react";
import {
  ArrowSquareOut,
  Check,
  CircleNotch,
  Play,
  Prohibit,
  X,
} from "@phosphor-icons/react";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import {
  updateLearningItemContentWithVersion,
  updateLearningItemTags,
  type LearningItem,
} from "../../api/learning-items";
import { bulkSuspendItems, bulkUnsuspendItems } from "../../api/queue";
import { sanitizeHtml } from "../common/RichContentRenderer";
import { hasRawClozeSyntax } from "../../utils/cloze";

interface InlineCardEditorProps {
  card: LearningItem;
  onClose: () => void;
  onSave: (updated: LearningItem) => void;
  /** Called after a successful persist (e.g. the review session closes the overlay). */
  onSaved?: () => void;
  onEditInStudio?: (card: LearningItem) => void;
  /** Which surface opened the editor; recorded in the version-history reason. */
  surface?: "deck-manager" | "review";
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

  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer ?? "");
  const [clozeText, setClozeText] = useState(card.cloze_text ?? card.question ?? "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [isSuspended, setIsSuspended] = useState(card.is_suspended);

  // Desktop serializes interaction_metadata; the browser backend camel-cases
  // it. Either spelling marks a complex interaction type.
  const interactionMetadata = (card as any).interaction_metadata ?? (card as any).interactionMetadata;
  const isComplexType = Boolean(interactionMetadata?.interactionType);

  // Item type casing varies by source (Rust serializes lowercase snake_case,
  // the browser backend camel-cases); match either, like ReviewCard does.
  const itemType = (card.item_type ?? (card as any).itemType) ?? "";
  const isCloze = itemType.toLowerCase() === "cloze";

  const handleSave = useCallback(async () => {
    setSaving(true);
    const prevCard = { ...card };

    const newTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Cloze saves edit the raw cloze markup and mirror it into `question`,
    // matching the `question || cloze_text` fallback consumers rely on.
    const effectiveQuestion = isCloze ? clozeText : question;
    const effectiveAnswer = isCloze ? card.answer : answer;
    const updated: LearningItem = {
      ...card,
      question: effectiveQuestion,
      answer: effectiveAnswer,
      tags: newTags,
      ...(isCloze ? { cloze_text: clozeText } : {}),
    };

    onSave(updated);

    try {
      await updateLearningItemContentWithVersion(
        card.id,
        effectiveQuestion,
        // Send the raw string ("" clears the answer); the backend leaves
        // omitted values untouched, and undefined would mean "don't touch".
        effectiveAnswer,
        surface === "review" ? "Edited during review" : "Edited via Deck Manager",
        isCloze ? clozeText : undefined,
      );

      if (newTags.join(",") !== card.tags.join(",")) {
        await updateLearningItemTags(card.id, newTags);
      }

      if (isCloze && !containsClozeMarker(clozeText)) {
        // Mirrors Anki's tolerance: the save goes through, but the author
        // should know the renderer found nothing to hide.
        toast.warning(t("reviewSession.clozeNoMarkerWarning"));
      } else {
        toast.success(t("review.deckManager.saved"));
      }
      onSaved?.();
    } catch {
      onSave(prevCard);
      toast.error(t("review.deckManager.saveError"));
    } finally {
      setSaving(false);
    }
  }, [card, question, answer, clozeText, tags, onSave, onSaved, isCloze, surface, toast, t]);

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

  const tagsChanged =
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(",") !== card.tags.join(",");

  return (
    <div className="border-t border-border bg-muted/30 p-4 space-y-3">
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
              <label
                htmlFor="inline-card-editor-cloze"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                {t("reviewSession.clozeTextLabel")}
              </label>
              <textarea
                id="inline-card-editor-cloze"
                value={clozeText}
                onChange={(e) => setClozeText(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px] resize-y font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
                rows={4}
              />
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("review.preview")}
              </div>
              <div
                data-testid="inline-card-editor-cloze-preview"
                className="text-sm p-2 rounded bg-background border border-border"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(clozeText) }}
              />
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

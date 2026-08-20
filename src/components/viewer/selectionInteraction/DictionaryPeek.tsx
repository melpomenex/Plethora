/**
 * DictionaryPeek — the shared compact dictionary card shown when a settled
 * selection resolves to a single lexical word (spec: dictionary-peek; change:
 * unify-selection-dictionary-lookup, design D4/D6).
 *
 * Phase-keyed READY presentation, sibling of `SelectionActionBar`: the HOST
 * decides visibility (auto-open on touch/double-click word settles, or an
 * explicit sheet/context-menu row) and passes a `target`; the peek owns
 * lookup, presentation, and its own dismissal. It is NOT a machine phase —
 * dictionary lookup never blocks subsequent selection changes.
 *
 * Guarantees:
 *  - shell renders immediately (word visible) before any network work;
 *  - the definition never depends on an LLM — the "In this passage"
 *    explanation is an explicit, streamed, cancellable enhancement, hidden
 *    when AI is unavailable;
 *  - typed failure states (not-found / unavailable / offline-uncached) with
 *    fallback actions, never a silent failure or infinite spinner;
 *  - e-ink + reducedMotion: no transitions, no translucent scrims;
 *  - dismissal goes through the host's controller dismiss path — the native
 *    selection is never cleared by the peek itself (touch policy);
 *  - queue-safe by construction: touches only the query cache, the
 *    vocabulary store, TTS, and explicit user actions.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowsClockwise,
  BookOpen,
  Copy,
  DotsThree,
  Lightbulb,
  NotePencil,
  SpeakerHigh,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { usePresentation, useIsEink } from "../../../contexts/PresentationContext";
import { useOverlayDismissal } from "../../../hooks/useOverlayDismissal";
import { useHapticFeedback } from "../../../hooks/useHapticFeedback";
import { useTTS } from "../../../hooks/useTTS";
import { useDictionaryEntry } from "../../../hooks/useDictionaryEntry";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useLanguageKnowledgeStore } from "../../../stores/languageKnowledgeStore";
import { LanguageKnowledgeStateSelector } from "../../common/LanguageKnowledgeStateSelector";
import type { LanguageKnowledgeStateSnapshot } from "../../../types/languageKnowledge";
import { memorizeLanguageDraft } from "../../../api/languageSrs";
import { createExtract } from "../../../api/extracts";
import { useUndoableOperations } from "../../../api/undoable";
import { useToast } from "../../common/Toast";
import { answerPassage } from "../../../lib/ai/passageAI";
import { copySelectionTextToClipboard } from "../SelectionPopup";
import { SELECTION_INTERACTION_UI_ATTR } from "./adapters";
import {
  anchorRectFromGeometry,
  placePeekCard,
  readLayoutViewport,
  readSafeInsets,
  type PeekCardPlacement,
  type SelectionGeometry,
} from "./geometry";
import { resolveSelectionIntent } from "./intent";
import type {
  PeekAnalysisContext,
  PeekPhraseContext,
  PeekSentenceContext,
} from "../../../lib/languagePeek";
import type { SourceAnchor } from "../../../types/languageLexicon";

/** What the peek looks up — derived from a READY selection or a menu row. */
export interface DictionaryPeekTarget {
  /** Raw selected text (normalized through the shared resolver inside). */
  text: string;
  /** Selection + surrounding block text for the AI passage explanation. */
  passage?: string;
  /** Optional active language context supplied by a profile-aware reader. */
  profileId?: string;
  languageTag?: string;
  analysis?: PeekAnalysisContext;
  phrase?: PeekPhraseContext;
  sentence?: PeekSentenceContext;
  sourceAnchor?: SourceAnchor;
  /** Surface anchor (EPUB CFI / PDF canonical / text offsets / null). */
  selectionContext?: unknown;
  /** Viewport-space geometry for anchoring; null → bottom-anchored card. */
  geometry: SelectionGeometry | null;
}

export interface DictionaryPeekProps {
  target: DictionaryPeekTarget | null;
  documentId: string | null;
  onDismiss: () => void;
  /** More → the host's standard overflow surface (context menu / sheet). */
  onMore?: () => void;
  /** Original-audio-first replay resolver supplied by audio-aware readers. */
  onReplayOriginalAudio?: (anchor: SourceAnchor) => void | Promise<void>;
  /**
   * Host-owned extract flow (RSS lazy document creation, viewer toast-with-
   * Edit wiring). When omitted, the built-in `createInstantExtract` runs
   * against `documentId`; extract hides when neither is possible.
   */
  onCreateExtract?: (text: string) => void | Promise<void>;
  aiAvailable?: boolean;
  /** TTS readiness; Pronounce hidden when false. */
  canPronounce?: boolean;
  /** Focus returns here after Escape dismissal. */
  readerContainerRef?: React.RefObject<HTMLElement | null>;
}

const DEFAULT_PEEK_SIZE = { width: 340, height: 260 };

type ExplainState =
  | { state: "idle" }
  | { state: "running"; text: string }
  | { state: "done"; text: string }
  | { state: "error" };

export function DictionaryPeek({
  target,
  documentId,
  onDismiss,
  onMore,
  onReplayOriginalAudio,
  onCreateExtract,
  aiAvailable = false,
  canPronounce = true,
  readerContainerRef,
}: DictionaryPeekProps) {
  const { t } = useI18n();
  const presentation = usePresentation();
  const isEink = useIsEink();
  const reducedMotion = presentation.reducedMotion || isEink;
  const compact = presentation.pointer === "coarse" || presentation.isMobileShell;
  const tts = useTTS();
  const toast = useToast();
  const haptics = useHapticFeedback();
  const { deleteLearningItem } = useUndoableOperations();
  const activeProfileId = useLanguageProfileStore((state) => state.activeProfileId);

  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(DEFAULT_PEEK_SIZE);
  const [explain, setExplain] = useState<ExplainState>({ state: "idle" });
  const explainAbortRef = useRef<AbortController | null>(null);
  const [flashcardSaving, setFlashcardSaving] = useState(false);

  const open = Boolean(target);
  const lookup = useDictionaryEntry(target?.text, documentId, target ? {
    profileId: activeProfileId ?? target.profileId,
    languageTag: target.languageTag,
    analysis: target.analysis,
    phrase: target.phrase,
    sentence: target.sentence,
    sourceAnchor: target.sourceAnchor,
  } : undefined);

  // Resolve the display word through the shared resolver (never a local
  // split heuristic).
  const resolved = useMemo(() => (target ? resolveSelectionIntent(target.text) : null), [target]);
  const displayWord = resolved?.kind === "word" ? resolved.word : target?.text.trim() ?? "";
  const [knowledgeState, setKnowledgeState] = useState<LanguageKnowledgeStateSnapshot | null>(null);
  const entry = lookup.data?.ok ? lookup.data.entry : null;
  const failure = lookup.data?.ok === false ? lookup.data.failure : null;
  const loading = lookup.isPending;

  useEffect(() => {
    let cancelled = false;
    setKnowledgeState(null);
    if (activeProfileId && displayWord) {
      void useLanguageKnowledgeStore.getState().resolveSurface(activeProfileId, displayWord).then((snapshot) => {
        if (!cancelled) setKnowledgeState(snapshot);
      }).catch(() => {
        if (!cancelled) setKnowledgeState(null);
      });
    }
    return () => { cancelled = true; };
  }, [activeProfileId, displayWord]);

  const handleKnowledgeStateChange = useCallback(async (state: LanguageKnowledgeStateSnapshot["state"]) => {
    if (!activeProfileId || !knowledgeState) return;
    const next = await useLanguageKnowledgeStore.getState().setState({ profileId: activeProfileId, entryId: knowledgeState.lexicalEntryId, state });
    setKnowledgeState(next);
  }, [activeProfileId, knowledgeState]);

  // Reset per-target transient state (explanation stream, saving flag).
  useEffect(() => {
    explainAbortRef.current?.abort();
    explainAbortRef.current = null;
    setExplain({ state: "idle" });
    setFlashcardSaving(false);
    // Haptic on open: best-effort, failure-silent (spec: auto-open).
    if (target) {
      try {
        haptics.click();
      } catch {
        /* haptics unavailable — peek still opens */
      }
    }
    // haptics.click is a stable convenience fn from the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Abort any in-flight explanation on unmount.
  useEffect(
    () => () => {
      explainAbortRef.current?.abort();
    },
    [],
  );

  // Back-button dismissal (overlayStack) + Escape with focus return, no trap.
  useOverlayDismissal(open, () => {
    onDismiss();
    readerContainerRef?.current?.focus?.();
  });

  // Tap-outside dismissal. The peek is own-UI for the selection controller,
  // so touches on it never demote the machine.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onDismiss]);

  // Placement: anchored popover from the selection geometry (desktop) /
  // compact anchored card (mobile), with the bottom fallback when geometry
  // is null. Re-anchored on viewport changes while open.
  const [placement, setPlacement] = useState<PeekCardPlacement | null>(null);
  useLayoutEffect(() => {
    if (!open || !target) {
      setPlacement(null);
      return;
    }
    const compute = () => {
      const viewport = readLayoutViewport();
      const anchor = target.geometry
        ? anchorRectFromGeometry(target.geometry, viewport)
        : null;
      setPlacement(placePeekCard(anchor, size, viewport, readSafeInsets()));
    };
    compute();
    // Self-measure so the next placement uses the real card size.
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    }
    window.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("resize", compute);
    };
  }, [open, target, size]);

  const runExplain = useCallback(() => {
    if (!target) return;
    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    setExplain({ state: "running", text: "" });
    const passage = target.passage?.trim() || target.text;
    void answerPassage(t("viewer.dictionaryPeek.explainQuestion", { word: displayWord }), passage, {
      signal: controller.signal,
      onChunk: (chunk) => {
        if (controller.signal.aborted) return;
        setExplain((prev) =>
          prev.state === "running" ? { state: "running", text: prev.text + chunk } : prev,
        );
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setExplain({ state: "done", text: result.text });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setExplain({ state: "error" });
      });
  }, [target, displayWord, t]);

  const handlePronounce = useCallback(async () => {
    if (!displayWord) return;
    if (target?.sourceAnchor && onReplayOriginalAudio) {
      try {
        await onReplayOriginalAudio(target.sourceAnchor);
        return;
      } catch {
        // Fall through to TTS when original audio cannot be resolved.
      }
    }
    void tts.speak(displayWord).catch(() => {
      /* TTS unavailable — silent; the button is gated by canPronounce anyway */
    });
  }, [tts, displayWord, target?.sourceAnchor, onReplayOriginalAudio]);

  const handleCopyWord = useCallback(() => {
    void copySelectionTextToClipboard(displayWord);
  }, [displayWord]);

  const handleExtract = useCallback(() => {
    if (!target) return;
    const definition = entry?.senses[0]?.definition;
    const text = definition ? `${displayWord} — ${definition}` : displayWord;
    if (onCreateExtract) {
      void Promise.resolve(onCreateExtract(text)).then(() => onDismiss());
      return;
    }
    if (documentId) {
      void createExtract({
        document_id: documentId,
        content: text,
        selection_context: target.selectionContext as Record<string, unknown> | undefined,
      })
        .then(() => onDismiss())
        .catch(() => {
          /* extract failed — peek stays open for a retry */
        });
    }
  }, [target, entry, displayWord, onCreateExtract, documentId, onDismiss]);

  const handleFlashcard = useCallback(async () => {
    if (!target || flashcardSaving) return;
    setFlashcardSaving(true);
    try {
      const memorizeText = target.phrase?.normalizedForm ?? displayWord;
      const answer =
        entry?.senses
          .map((sense) =>
            [sense.partOfSpeech, sense.definition].filter(Boolean).join(": ").trim(),
          )
          .filter(Boolean)
          .join("\n") || entry?.synonyms.join(", ") || "";
      const result = await memorizeLanguageDraft({
        itemType: "flashcard",
        question: `Define: ${memorizeText}`,
        ...(answer ? { answer } : {}),
        documentId: documentId ?? undefined,
        provenance: {
          origin: target.phrase ? "phrase" : "dictionary-peek",
          profileId: activeProfileId ?? target.profileId ?? "local",
          lexicalEntryId: knowledgeState?.lexicalEntryId,
          sourceAnchor: target.sourceAnchor,
          createdAt: Date.now(),
        },
        interactionMetadata: {
          sentence: (target.passage ?? target.text).slice(0, 500),
          documentId,
        },
      });
      const item = result.item;
      toast.success(t("viewer.dictionaryPeek.flashcardCreated"), undefined, {
        duration: 8000,
        action: {
          label: t("viewer.dictionaryPeek.undo"),
          onClick: () => {
            void deleteLearningItem(item.id);
          },
        },
      });
    } catch (error) {
      toast.error(
        t("viewer.dictionaryPeek.flashcardFailed"),
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setFlashcardSaving(false);
    }
  }, [target, entry, displayWord, documentId, flashcardSaving, toast, t, deleteLearningItem, activeProfileId, knowledgeState]);

  if (!open || !target) return null;

  const canExtract = Boolean(onCreateExtract || documentId);
  const surfaceClass = reducedMotion
    ? "border border-border bg-card shadow-md"
    : "border border-border bg-card/97 shadow-xl backdrop-blur-sm";

  const actionButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-foreground active:bg-muted disabled:opacity-50 ${
        reducedMotion ? "" : "transition-colors"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );

  const renderFailure = () => {
    const message =
      failure?.kind === "not-found"
        ? t("viewer.dictionaryPeek.notFound", { word: displayWord })
        : failure?.kind === "offline-uncached"
          ? t("viewer.dictionaryPeek.offline")
          : t("viewer.dictionaryPeek.unavailable");
    return (
      <div className="space-y-2">
        <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex flex-wrap items-center gap-1">
          {failure && failure.kind !== "not-found" && (
            <button
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-foreground active:bg-muted"
              onClick={() => void lookup.refetch()}
            >
              <ArrowsClockwise className="h-4 w-4" aria-hidden="true" />
              {t("viewer.dictionaryPeek.retry")}
            </button>
          )}
          {aiAvailable &&
            actionButton(
              t("viewer.dictionaryPeek.explain"),
              <Lightbulb className="h-4 w-4" />,
              runExplain,
            )}
          {actionButton(
            t("viewer.dictionaryPeek.copyWord"),
            <Copy className="h-4 w-4" />,
            handleCopyWord,
          )}
          {actionButton(
            t("viewer.dictionaryPeek.flashcard"),
            <NotePencil className="h-4 w-4" />,
            () => void handleFlashcard(),
            flashcardSaving,
          )}
        </div>
        {explain.state !== "idle" && renderExplain()}
      </div>
    );
  };

  const renderExplain = () => (
    <div className="space-y-1.5 border-t border-border/70 pt-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        {t("viewer.dictionaryPeek.explainSection")}
        {explain.state === "running" && (
          <ArrowsClockwise className="h-3 w-3 animate-spin" aria-hidden="true" />
        )}
        {explain.state === "running" && (
          <button
            type="button"
            className="ml-auto text-[11px] normal-case text-muted-foreground"
            onClick={() => {
              explainAbortRef.current?.abort();
              setExplain({ state: "idle" });
            }}
          >
            {t("viewer.dictionaryPeek.stop")}
          </button>
        )}
      </div>
      {explain.state === "error" && (
        <p className="text-[12px] text-muted-foreground">{t("viewer.dictionaryPeek.explainFailed")}</p>
      )}
      {(explain.state === "running" || explain.state === "done") && (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {explain.text || (explain.state === "running" ? t("viewer.dictionaryPeek.explainRunning") : "")}
        </p>
      )}
    </div>
  );

  const renderLanguageContext = () => {
    if (!target.analysis && !target.phrase && !target.sentence) return null;
    return (
      <div className="space-y-1.5 border-t border-border/70 pt-2" data-testid="language-peek-context">
        {target.analysis && (
          <details open={Boolean(target.analysis.morphology)} className="text-[12px] text-muted-foreground">
            <summary className="cursor-pointer select-none">
              {target.analysis.lemma ? `Lemma: ${target.analysis.lemma}` : "Language analysis"}
            </summary>
            <div className="mt-1 space-y-0.5">
              {target.analysis.partOfSpeech && <p>Part of speech: {target.analysis.partOfSpeech}</p>}
              {target.analysis.confidence !== undefined && (
                <p>Analysis confidence: {Math.round(target.analysis.confidence * 100)}%</p>
              )}
              {target.analysis.morphology && (
                <p className="whitespace-pre-wrap">{JSON.stringify(target.analysis.morphology)}</p>
              )}
            </div>
          </details>
        )}
        {target.phrase && (
          <div>
            <span className="font-medium text-foreground">Phrase: </span>
            {target.phrase.translation || target.phrase.meaning || target.phrase.normalizedForm}
          </div>
        )}
        {target.sentence && (
          <div>
            <span className="font-medium text-foreground">Context: </span>
            <span className="italic">{target.sentence.text}</span>
            {target.sentence.translation && <span> — {target.sentence.translation}</span>}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div
      {...{ [SELECTION_INTERACTION_UI_ATTR]: "true" }}
      ref={cardRef}
      role="dialog"
      aria-label={t("viewer.dictionaryPeek.title", { word: displayWord })}
      dir="ltr"
      data-eink={isEink ? "true" : undefined}
      className={`fixed z-[9998] flex flex-col overflow-y-auto rounded-2xl p-3 ${surfaceClass} ${
        reducedMotion ? "" : "animate-in fade-in-0 zoom-in-95 duration-150"
      }`}
      style={{
        top: Math.round(placement?.top ?? 0),
        left: Math.round(placement?.left ?? 0),
        maxWidth: Math.round(placement?.maxWidth ?? DEFAULT_PEEK_SIZE.width),
        maxHeight: Math.round(placement?.maxHeight ?? DEFAULT_PEEK_SIZE.height),
        width: compact ? undefined : DEFAULT_PEEK_SIZE.width,
        visibility: placement ? undefined : "hidden",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{displayWord}</h3>
          {entry?.phonetic && (
            <p className="text-[12px] text-muted-foreground">{entry.phonetic}</p>
          )}
        </div>
        <button
          type="button"
          aria-label={t("viewer.dictionaryPeek.close")}
          className="-mr-1 -mt-1 rounded-full p-1.5 text-muted-foreground active:bg-muted"
          onClick={() => {
            onDismiss();
            readerContainerRef?.current?.focus?.();
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1 min-h-0 flex-1 space-y-2" aria-busy={loading} aria-live="polite">
        {loading && (
          <div className="space-y-1.5 py-1">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <p className="sr-only">{t("viewer.dictionaryPeek.loading")}</p>
          </div>
        )}

        {!loading && failure && renderFailure()}

        {!loading && entry && (
          <>
            {knowledgeState && (
              <LanguageKnowledgeStateSelector
                value={knowledgeState.state}
                onChange={handleKnowledgeStateChange}
              />
            )}
            <div>
              {entry.senses[0]?.partOfSpeech && (
                <span className="mr-2 text-[11px] font-medium italic text-muted-foreground">
                  {entry.senses[0].partOfSpeech}
                </span>
              )}
              <p className="text-[14px] leading-relaxed text-foreground">
                {entry.senses[0]?.definition}
              </p>
              {entry.senses[0]?.example && (
                <p className="mt-1 text-[12px] italic text-muted-foreground">
                  “{entry.senses[0].example}”
                </p>
              )}
            </div>

            {entry.senses.length > 1 && (
              <details className="text-[13px] text-muted-foreground">
                <summary className="cursor-pointer select-none text-[12px] text-muted-foreground">
                  {t("viewer.dictionaryPeek.moreSenses", { count: entry.senses.length - 1 })}
                </summary>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  {entry.senses.slice(1).map((sense, index) => (
                    <li key={index}>
                      {sense.partOfSpeech && <em className="mr-1 not-italic">{sense.partOfSpeech}:</em>}
                      {sense.definition}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {entry.synonyms.length > 0 && (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium">{t("viewer.dictionaryPeek.synonyms")}: </span>
                {entry.synonyms.slice(0, 5).join(", ")}
              </p>
            )}

            {renderLanguageContext()}

            {aiAvailable && explain.state !== "idle" && renderExplain()}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/70 pt-2">
        {canPronounce &&
          actionButton(
            t("viewer.dictionaryPeek.pronounce"),
            <SpeakerHigh className="h-4 w-4" />,
            handlePronounce,
          )}
        {aiAvailable && explain.state === "idle" && entry &&
          actionButton(
            t("viewer.dictionaryPeek.explain"),
            <Lightbulb className="h-4 w-4" />,
            runExplain,
          )}
        {canExtract &&
          actionButton(
            t("viewer.dictionaryPeek.extract"),
            <Lightbulb className="h-4 w-4" weight="fill" />,
            handleExtract,
          )}
        {actionButton(
          t("viewer.dictionaryPeek.flashcard"),
          <NotePencil className="h-4 w-4" />,
          () => void handleFlashcard(),
          flashcardSaving,
        )}
        {onMore &&
          actionButton(t("viewer.dictionaryPeek.more"), <DotsThree className="h-4 w-4" weight="bold" />, onMore)}
      </div>
    </div>,
    document.body,
  );
}

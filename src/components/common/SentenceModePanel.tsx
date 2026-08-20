import type { SentenceModeFreshness, SentenceModeSession, SentenceSegment } from "../../lib/languageSentenceMode";

export interface SentenceModePanelProps {
  session: SentenceModeSession;
  sentence: SentenceSegment | null;
  translation?: string;
  translationState?: SentenceModeFreshness;
  onPrevious: () => void;
  onNext: () => void;
  onPlay: () => void;
  onReplay: () => void;
  onRevealTranslation: () => void;
  onInspectVocabulary: (text: string) => void;
  onGrammar: (text: string) => void;
  onPractice: (text: string) => void;
  onExit: () => void;
  reducedMotion?: boolean;
  eInk?: boolean;
}

/** Opt-in, source-preserving sentence surface. It never owns Queue progress. */
export function SentenceModePanel({
  session,
  sentence,
  translation,
  translationState = "ready",
  onPrevious,
  onNext,
  onPlay,
  onReplay,
  onRevealTranslation,
  onInspectVocabulary,
  onGrammar,
  onPractice,
  onExit,
  reducedMotion = false,
  eInk = false,
}: SentenceModePanelProps) {
  const staticSurface = reducedMotion || eInk;
  const busy = session.freshness === "pending" || translationState === "pending";
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="sentence-mode-title"
      aria-busy={busy}
      data-eink={eInk ? "true" : undefined}
      className={`mx-auto flex max-w-2xl flex-col gap-5 rounded-2xl border border-border bg-card p-5 text-card-foreground ${staticSurface ? "" : "shadow-xl"}`}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 id="sentence-mode-title" className="text-lg font-semibold">Sentence Mode</h2>
          <p className="text-xs text-muted-foreground">{session.progress.current + 1}{session.progress.total ? ` / ${session.progress.total}` : ""}</p>
        </div>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onExit}>Exit</button>
      </header>

      {session.freshness === "stale" && <p role="status" className="rounded border border-amber-500/50 p-3 text-sm">This sentence index changed. Return to the reader and reopen Sentence Mode.</p>}
      {session.freshness === "unsupported" && <p role="status" className="rounded border border-border p-3 text-sm">Sentence Mode is not available for this source.</p>}
      {sentence && session.freshness !== "stale" && (
        <button type="button" className="text-left text-xl leading-relaxed" onClick={() => onInspectVocabulary(sentence.text)} aria-label="Inspect vocabulary in sentence">
          {sentence.text}
        </button>
      )}

      <div className="flex flex-wrap gap-2" aria-label="Sentence controls">
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onPrevious} disabled={!session.progress.current}>Previous</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onNext} disabled={session.progress.total !== undefined && session.progress.current + 1 >= session.progress.total}>Next</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onPlay}>Play</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onReplay}>Replay</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={() => sentence && onGrammar(sentence.text)} disabled={!sentence}>Grammar</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={() => sentence && onPractice(sentence.text)} disabled={!sentence}>Practice</button>
      </div>

      <div className="border-t border-border pt-4">
        {translationState === "pending" && <p role="status" className="text-sm text-muted-foreground">Translation loading…</p>}
        {translationState === "offline" && <p role="status" className="text-sm text-muted-foreground">Translation unavailable offline.</p>}
        {translationState === "stale" && <p role="status" className="text-sm text-muted-foreground">Translation is stale for this sentence.</p>}
        {translationState === "ready" && translation ? <p className="text-sm leading-relaxed">{translation}</p> : translationState === "ready" ? <button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={onRevealTranslation}>Reveal translation</button> : null}
      </div>
    </section>
  );
}

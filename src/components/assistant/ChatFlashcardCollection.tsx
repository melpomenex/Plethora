import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretDown,
  CaretUp,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  Cards,
  Eye,
  FolderOpen,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ChatFlashcardArtifact } from "../../features/assistant/chatFlashcardArtifacts";

interface ChatFlashcardCollectionProps {
  artifacts: ChatFlashcardArtifact[];
  visibleLimit?: number;
  onOpen?: (artifact: ChatFlashcardArtifact) => void;
  onRetry?: (artifact: ChatFlashcardArtifact) => void;
  onCopy?: (artifacts: ChatFlashcardArtifact[]) => boolean | Promise<boolean>;
  deckAction?: {
    name: string;
    exists: boolean;
    onCreate: () => void;
    onOpen: () => void;
  };
}

const stateLabel = (artifact: ChatFlashcardArtifact) =>
  artifact.status === "saved" ? "Saved" : artifact.status === "failed" ? "Needs attention" : "Saving";

export function ChatFlashcardCollection({
  artifacts,
  visibleLimit = 3,
  onOpen,
  onRetry,
  onCopy,
  deckAction,
}: ChatFlashcardCollectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Cleared on unmount so the "copied" reset can never fire after teardown
  // (tests tear down jsdom mid-timer; the app avoids setState-after-unmount).
  const copiedResetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedResetTimer.current !== null) {
        window.clearTimeout(copiedResetTimer.current);
      }
    },
    []
  );
  const visible = useMemo(
    () => expanded ? artifacts : artifacts.slice(0, Math.max(1, visibleLimit)),
    [artifacts, expanded, visibleLimit],
  );
  if (artifacts.length === 0) return null;

  const savedCount = artifacts.filter((artifact) => artifact.status === "saved").length;
  const failedCount = artifacts.filter((artifact) => artifact.status === "failed").length;
  const statusText = failedCount > 0
    ? `${failedCount} need${failedCount === 1 ? "s" : ""} attention`
    : savedCount === artifacts.length
      ? "Saved"
      : "Saving";

  const handleCopy = async () => {
    if (!onCopy) return;
    const success = await onCopy(artifacts);
    if (success === false) return;
    setCopied(true);
    if (copiedResetTimer.current !== null) {
      window.clearTimeout(copiedResetTimer.current);
    }
    copiedResetTimer.current = window.setTimeout(() => {
      copiedResetTimer.current = null;
      setCopied(false);
    }, 1800);
  };

  return (
    <section
      className="mt-3 overflow-hidden rounded-xl border border-border/80 bg-background/75 shadow-sm"
      aria-label={`${artifacts.length} created flashcard${artifacts.length === 1 ? "" : "s"}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Cards className="h-4 w-4" weight="duotone" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">Flashcards</p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{artifacts.length} card{artifacts.length === 1 ? "" : "s"}</span>
              <span aria-hidden="true">·</span>
              <span className={failedCount > 0 ? "text-destructive" : savedCount === artifacts.length ? "text-emerald-600 dark:text-emerald-300" : ""}>
                {statusText}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onCopy && (
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
              onClick={() => void handleCopy()}
              aria-label="Copy all flashcards"
              title="Copy all cards"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" weight="bold" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          {deckAction && (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground shadow-sm transition-[filter,transform] hover:brightness-105 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              onClick={deckAction.exists ? deckAction.onOpen : deckAction.onCreate}
              aria-label={`${deckAction.exists ? "Open" : "Create"} deck ${deckAction.name}`}
              title={deckAction.exists ? `Open “${deckAction.name}”` : `Create “${deckAction.name}” from these cards`}
            >
              {deckAction.exists ? <FolderOpen className="h-3.5 w-3.5" weight="bold" /> : <Plus className="h-3.5 w-3.5" weight="bold" />}
              {deckAction.exists ? "Open deck" : "Create deck"}
            </button>
          )}
        </div>
      </div>

      <ul className="divide-y divide-border/60" role="list">
        {visible.map((artifact, index) => {
          const sourceLabel = artifact.source?.labels.join(", ");
          return (
            <li key={artifact.id} className="group/card relative">
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:transition-none"
                aria-label={`Open ${artifact.type === "qa" ? "question and answer" : "cloze"} flashcard ${index + 1}: ${artifact.front}`}
                aria-expanded={openArtifactId === artifact.id}
                onClick={() => {
                  setOpenArtifactId((current) => current === artifact.id ? null : artifact.id);
                  onOpen?.(artifact);
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {artifact.type === "qa" ? "Q&A" : "Cloze"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium leading-5 text-foreground">{artifact.front}</p>
                    {artifact.back && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-muted-foreground">{artifact.back}</p>
                    )}
                    <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="inline-flex shrink-0 items-center gap-1">
                        {artifact.status === "saved" ? <CheckCircle className="h-3 w-3 text-emerald-500" weight="fill" /> :
                          artifact.status === "failed" ? <WarningCircle className="h-3 w-3 text-destructive" weight="fill" /> :
                          <CircleNotch className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
                        {stateLabel(artifact)}
                      </span>
                      {sourceLabel && <span className="truncate">{sourceLabel}</span>}
                    </div>
                    {artifact.status === "failed" && artifact.error && (
                      <p className="mt-1 line-clamp-2 text-[10px] text-destructive">{artifact.error}</p>
                    )}
                    {openArtifactId === artifact.id && (
                      <div className="mt-2 rounded-lg border border-border/70 bg-muted/35 p-2 text-[11px] leading-5 text-foreground">
                        <p className="whitespace-pre-wrap">{artifact.front}</p>
                        {artifact.back && (
                          <p className="mt-2 border-t border-border/60 pt-2 whitespace-pre-wrap text-muted-foreground">{artifact.back}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <Eye className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 motion-reduce:transition-none" />
                </div>
              </button>
              {artifact.status === "failed" && artifact.retryable !== false && onRetry && (
                <button
                  type="button"
                  className="absolute bottom-2.5 right-3 rounded-md border border-destructive/30 bg-background px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={(event) => { event.stopPropagation(); onRetry(artifact); }}
                  aria-label={`Retry saving flashcard: ${artifact.front}`}
                >
                  Retry
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {artifacts.length > visibleLimit && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1 border-t border-border/70 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <CaretUp className="h-3 w-3" /> : <CaretDown className="h-3 w-3" />}
          {expanded ? "Show fewer" : `Show ${artifacts.length - visibleLimit} more`}
        </button>
      )}
    </section>
  );
}

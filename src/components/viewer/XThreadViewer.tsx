/**
 * XThreadViewer — the dedicated native Plethora reader for X threads.
 *
 * Renders a normalized `metadata.xThread` as a theme-native reading surface:
 * author header, centered reading column (`max-width: min(720px, ...)`),
 * chronological spine, post cards with media/quotes/actions, native skeleton
 * and error states, mobile bottom toolbar + assistant sheet, per-post
 * selection with provenance, and scroll-to-post from AI citations.
 *
 * Never uses an iframe, never injects raw HTML (all content is structured
 * data parsed in Rust), and only uses Plethora theme tokens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Document, TwitterPost, TwitterThread } from "../../types/document";
import type { XThreadPostProvenance, TextSelectionContext } from "../../types/selection";
import { cn } from "../../utils";
import { openExternal } from "../../lib/tauri";
import { useToast } from "../common/Toast";
import { useDocumentStore } from "../../stores";
import { useMobileShell } from "../../hooks/useMobileShell";
import { resolveTwitterThreadAssistantContext } from "../../utils/assistantContext";
import { answerPassage, keyTermsPassage, summarizePassage } from "../../lib/ai/passageAI";
import * as documentsApi from "../../api/documents";
import { createExtract } from "../../api/extracts";
import { XPostCard } from "./XPostCard";
import { XThreadSkeleton } from "./XThreadSkeleton";
import { XThreadErrorState } from "./XThreadErrorState";
import { XTHREAD_SCROLL_EVENT, XTHREAD_HIGHLIGHT_MS, type XThreadScrollDetail } from "./xthreadNav";
import { LanguageReaderDomBridge } from "../language/LanguageReaderDomBridge";
import { CheckCircle, ArrowSquareOut, FloppyDisk, DotsThree, CaretLeft, CaretUp, CaretDown, X as XIcon, PaperPlaneTilt, Sparkle, ListBullets, Question, NotePencil } from "@phosphor-icons/react";

export interface XThreadViewerProps {
  document: Document;
  embedded?: boolean;
  /** Seed the flashcard studio with a post's text (wired by DocumentViewer). */
  onCreateFlashcard?: (excerpt: string, provenance?: XThreadPostProvenance) => void;
  /** Called after an extract is created (refreshes the extracts tab). */
  onExtractCreated?: () => void;
}

/** True when a document should render through the native X thread viewer:
 *  either it carries `metadata.xThread`, or it is an in-flight/errored thread
 *  placeholder (`x-thread-*`) that must show the skeleton/error states. */
export function isXThreadDocument(doc: Document | null | undefined): boolean {
  return Boolean(doc && (doc.metadata?.xThread || doc.id.startsWith("x-thread-")));
}

function formatThreadDate(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Stable citation anchors: "Post N of M by @handle". */
function postProvenance(thread: TwitterThread, post: TwitterPost): XThreadPostProvenance {
  return {
    rootId: thread.rootId,
    rootUrl: thread.rootUrl,
    postId: post.id,
    postIndex: post.postIndex,
    author: post.author.screenName,
  };
}

type MobileSheetAction = "summary" | "insights" | "ask" | null;

export function XThreadViewer({ document: doc, onCreateFlashcard, onExtractCreated }: XThreadViewerProps) {
  const thread = doc.metadata?.xThread;
  const loading = Boolean(doc.metadata?.xThreadLoading);
  const threadError = doc.metadata?.xThreadError ?? null;
  const isMobile = useMobileShell();
  const toast = useToast();
  const openTwitterThread = useDocumentStore((s) => s.openTwitterThread);

  const containerRef = useRef<HTMLDivElement>(null);
  const [threadRoot, setThreadRoot] = useState<HTMLDivElement | null>(null);
  // Selection adapter state
  const [selection, setSelection] = useState<{
    text: string;
    rect: DOMRect;
    post: TwitterPost;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  // Mobile assistant sheet
  const [sheetAction, setSheetAction] = useState<MobileSheetAction>(null);
  const [sheetLevel, setSheetLevel] = useState<0 | 1 | 2>(1); // peek / half / full
  const [askInput, setAskInput] = useState("");
  const [sheetOutput, setSheetOutput] = useState<{ text: string; error?: string } | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [singlePostNoteDismissed, setSinglePostNoteDismissed] = useState(false);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const statusUrl = useMemo(() => {
    const t = thread ?? null;
    return t?.rootUrl || doc.filePath || undefined;
  }, [thread, doc.filePath]);

  const posts = useMemo(() => thread?.posts ?? [], [thread]);
  const totalPosts = thread?.totalPosts ?? posts.length;

  // ── scroll-to-post (AI citations, extract provenance) ───────────────────
  useEffect(() => {
    const onScroll = (e: Event) => {
      const detail = (e as CustomEvent<XThreadScrollDetail>).detail;
      if (!detail?.postId) return;
      if (detail.rootId && thread && detail.rootId !== thread.rootId) return;
      const el = document.getElementById(`x-post-${detail.postId}`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightedPostId(detail.postId);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(
        () => setHighlightedPostId(null),
        XTHREAD_HIGHLIGHT_MS
      );
    };
    window.addEventListener(XTHREAD_SCROLL_EVENT, onScroll);
    return () => {
      window.removeEventListener(XTHREAD_SCROLL_EVENT, onScroll);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, [thread]);

  // ── per-post selection adapter ──────────────────────────────────────────
  useEffect(() => {
    if (!thread) return;
    const container = containerRef.current;
    if (!container) return;

    const onSelectionChange = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || !text || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      // Find the post this selection lives in.
      const range = sel.getRangeAt(0);
      const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const postEl = node?.closest?.("[data-x-post]");
      if (!postEl) {
        setSelection(null);
        return;
      }
      const postId = postEl.getAttribute("data-x-post") ?? "";
      const post = posts.find((p) => p.id === postId);
      if (!post) return;

      // Offsets relative to the post body text.
      const bodyEl = postEl.querySelector('[data-x-post-body]');
      let startOffset = 0;
      let endOffset = 0;
      if (bodyEl) {
        const pre = document.createRange();
        pre.selectNodeContents(bodyEl);
        pre.setEnd(range.startContainer, range.startOffset);
        startOffset = pre.toString().length;
        const postRange = document.createRange();
        postRange.selectNodeContents(bodyEl);
        postRange.setEnd(range.endContainer, range.endOffset);
        endOffset = postRange.toString().length;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null);
        return;
      }
      setSelection({ text, rect, post, startOffset, endOffset });
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [thread, posts]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const buildSelectionContext = useCallback(
    (sel: NonNullable<typeof selection>): TextSelectionContext => ({
      type: "text",
      surface: "x-thread",
      documentId: doc.id,
      startOffset: sel.startOffset,
      endOffset: sel.endOffset,
      selectedText: sel.text,
      xThread: postProvenance(thread!, sel.post),
    }),
    [doc.id, thread]
  );

  const extractSelection = useCallback(async () => {
    if (!selection || !thread) return;
    const ctx = buildSelectionContext(selection);
    try {
      await createExtract({
        document_id: doc.id,
        content: selection.text,
        source_url: thread.rootUrl,
        note: `X thread post ${selection.post.postIndex} by @${selection.post.author.screenName}`,
        selection_context: ctx,
        tags: ["x", "twitter"],
      });
      toast.success("Extract created", "Saved from X thread");
      onExtractCreated?.();
      clearSelection();
    } catch (err) {
      console.error("Failed to create X thread extract:", err);
      toast.error("Extract failed", err instanceof Error ? err.message : "Unknown error");
    }
  }, [selection, thread, doc.id, buildSelectionContext, toast, onExtractCreated, clearSelection]);

  const extractWholePost = useCallback(
    async (post: TwitterPost) => {
      if (!thread) return;
      try {
        await createExtract({
          document_id: doc.id,
          content: post.fullText || post.text,
          source_url: post.url,
          note: `X thread post ${post.postIndex} by @${post.author.screenName}`,
          selection_context: {
            type: "text",
            surface: "x-thread",
            documentId: doc.id,
            startOffset: 0,
            endOffset: (post.fullText || post.text).length,
            selectedText: post.fullText || post.text,
            xThread: postProvenance(thread, post),
          },
          tags: ["x", "twitter"],
        });
        toast.success("Extract created", "Post saved as extract");
        onExtractCreated?.();
      } catch (err) {
        console.error("Failed to extract post:", err);
        toast.error("Extract failed", err instanceof Error ? err.message : "Unknown error");
      }
    },
    [thread, doc.id, toast, onExtractCreated]
  );

  const handleCreateFlashcard = useCallback(
    (post: TwitterPost) => {
      onCreateFlashcard?.(post.fullText || post.text, thread ? postProvenance(thread, post) : undefined);
    },
    [onCreateFlashcard, thread]
  );

  // ── Save to Documents (ephemeral web/fallback docs) ─────────────────────
  const saveToDocuments = useCallback(async () => {
    if (!thread) return;
    try {
      const saved = await documentsApi.importTwitterThread(thread.rootUrl, undefined, thread);
      useDocumentStore.setState((state) => ({
        documents: state.documents.map((d) => (d.id === doc.id ? { ...d, id: saved.id } : d)),
      }));
      toast.success("Saved to Documents", "Thread saved to your library");
    } catch (err) {
      console.error("Failed to save thread:", err);
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    }
  }, [thread, doc.id, toast]);

  // ── mobile assistant sheet ──────────────────────────────────────────────
  const runSheetAction = useCallback(
    async (action: Exclude<MobileSheetAction, null>) => {
      if (!thread) return;
      setSheetLoading(true);
      setSheetOutput(null);
      const resolved = resolveTwitterThreadAssistantContext(doc);
      const context = resolved.status === "ready" ? resolved.content : thread.structuredText;
      try {
        let text = "";
        if (action === "summary") {
          const res = await summarizePassage(context, { maxWords: 220 });
          text = res.text;
        } else if (action === "insights") {
          const res = await keyTermsPassage(context, { count: 5 });
          text = res.text;
        } else {
          const res = await answerPassage(
            askInput.trim() || "Summarize the key argument of this thread.",
            context
          );
          text = res.text;
        }
        setSheetOutput({ text });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSheetOutput({
          text: "",
          error: /unavailable|not configured|no api|key|provider/i.test(message)
            ? "AI is unavailable — the thread remains fully readable."
            : message,
        });
      } finally {
        setSheetLoading(false);
      }
    },
    [thread, document, askInput]
  );

  const openSheet = useCallback((action: "summary" | "insights" | "ask") => {
    setSheetAction(action);
    setSheetOutput(null);
    setAskInput("");
    setSheetLevel(1);
    // Summary/Insights run immediately; Ask waits for the user's question.
    if (action !== "ask") void runSheetAction(action);
  }, [runSheetAction]);

  const closeSheet = useCallback(() => {
    setSheetAction(null);
    setSheetLevel(1);
    setSheetOutput(null);
  }, []);

  // Escape closes menus/sheet; body scroll lock while the sheet is open.
  useEffect(() => {
    if (!sheetAction) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetAction, closeSheet]);

  const handleRetry = useCallback(() => {
    void openTwitterThread(doc.filePath);
  }, [openTwitterThread, doc.filePath]);

  // ── render ──────────────────────────────────────────────────────────────
  if (loading || (!thread && !threadError)) {
    return <XThreadSkeleton postCount={Math.max(3, Math.min(8, totalPosts || 4))} />;
  }

  if (!thread || threadError) {
    return (
      <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-background px-4 py-16">
        <XThreadErrorState
          error={threadError ?? new Error("Thread could not be loaded")}
          statusUrl={statusUrl}
          onRetry={handleRetry}
        />
      </div>
    );
  }

  const isSinglePostNote = thread.sourceKind === "single" && !singlePostNoteDismissed;

  return (
    <div
      ref={(element) => {
        containerRef.current = element;
        setThreadRoot(element);
      }}
      data-testid="x-thread-viewer"
      data-thread-root={thread.rootId}
      className={cn(
        "h-full w-full overflow-y-auto bg-background text-foreground",
        isMobile && "overscroll-contain"
      )}
      style={isMobile ? { scrollPaddingBottom: 88 } : undefined}
      onMouseUp={() => {
        // Keep the selection adapter fresh after mouse-based selections.
        setTimeout(() => document.dispatchEvent(new Event("selectionchange")), 0);
      }}
    >
      {/* Author header */}
      <header
        className={cn(
          "border-b border-border/60",
          isMobile ? "sticky top-0 z-20 bg-background/95 backdrop-blur-sm" : "pt-8"
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full items-center gap-3",
            "max-w-[min(720px,100%-2*clamp(16px,4vw,32px))]",
            isMobile ? "px-4 pb-3 pt-2" : "px-0 pb-4"
          )}
        >
          {isMobile && (
            <button
              onClick={() => window.history.back()}
              aria-label="Back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <CaretLeft size={18} weight="bold" />
            </button>
          )}
          {thread.author.avatarUrl ? (
            <img
              src={thread.author.avatarUrl}
              alt={`@${thread.author.screenName}`}
              className="h-10 w-10 shrink-0 rounded-full bg-muted object-cover"
              loading="lazy"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground"
            >
              {thread.author.name.trim().charAt(0).toUpperCase() || "@"}
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1">
              <span className="truncate text-[15px] font-bold text-foreground">{thread.author.name}</span>
              {thread.author.verified && (
                <CheckCircle
                  size={15}
                  weight="fill"
                  className="shrink-0 text-primary"
                  aria-label="Verified"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">@{thread.author.screenName}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">
                X thread · {totalPosts} post{totalPosts === 1 ? "" : "s"}
              </span>
              {formatThreadDate(thread.createdAt) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{formatThreadDate(thread.createdAt)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!isMobile && (
              <>
                <button
                  onClick={() => openExternal(thread.rootUrl)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <ArrowSquareOut size={13} />
                  Open on X
                </button>
                {doc.id.startsWith("x-thread-") && (
                  <button
                    onClick={saveToDocuments}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <FloppyDisk size={13} />
                    Save to Documents
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => openExternal(thread.rootUrl)}
              aria-label="Open on X"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="Open on X"
            >
              <ArrowSquareOut size={16} />
            </button>
            <button
              onClick={saveToDocuments}
              aria-label="Save to Documents"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="Save to Documents"
            >
              <FloppyDisk size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Reading column */}
      <main
        className={cn(
          "mx-auto w-full",
          "max-w-[min(720px,100%-2*clamp(16px,4vw,32px))]",
          isMobile ? "px-4 pb-28" : "px-0 pb-16",
          isMobile && "overflow-x-clip"
        )}
      >
        {isSinglePostNote && (
          <div
            data-testid="x-single-post-note"
            className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
          >
            <span>Full thread could not be retrieved — showing this single post.</span>
            <button
              onClick={() => setSinglePostNoteDismissed(true)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <XIcon size={14} />
            </button>
          </div>
        )}

        {/* Thread spine + posts */}
        <div data-testid="x-thread-column">
          {posts.map((post, i) => (
            <div key={post.id} className="flex gap-2 sm:gap-3" data-testid="x-thread-post-row">
              {/* Spine rail */}
              <div
                aria-hidden="true"
                className="flex w-6 shrink-0 flex-col items-center sm:w-7"
              >
                <div
                  className={cn(
                    "mt-6 h-2.5 w-2.5 rounded-full border-2 border-border bg-background transition-colors",
                    highlightedPostId === post.id && "border-primary bg-primary/20",
                    i === posts.length - 1 ? "" : "mb-1"
                  )}
                />
                {i < posts.length - 1 && (
                  <div className="w-0.5 flex-1 rounded bg-border" />
                )}
              </div>
              {/* Post */}
              <div
                className={cn(
                  "min-w-0 flex-1 transition-shadow",
                  highlightedPostId === post.id && "rounded-2xl ring-2 ring-primary/40 motion-reduce:transition-none"
                )}
              >
                <XPostCard
                  post={post}
                  totalPosts={totalPosts}
                  onExtractPost={extractWholePost}
                  onCreateFlashcard={handleCreateFlashcard}
                />
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Mobile bottom learning toolbar */}
      {isMobile && !sheetAction && (
        <nav
          data-testid="x-thread-mobile-toolbar"
          aria-label="Thread learning actions"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
        >
          <div className="flex items-stretch justify-around px-2 pt-1.5">
            {[
              { action: "summary" as const, icon: <Sparkle size={18} />, label: "Summary" },
              { action: "insights" as const, icon: <ListBullets size={18} />, label: "Insights" },
              { action: "ask" as const, icon: <Question size={18} />, label: "Ask" },
            ].map((item) => (
              <button
                key={item.action}
                onClick={() => openSheet(item.action)}
                className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <button
              onClick={() => void openExternal(thread.rootUrl)}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ArrowSquareOut size={18} />
              More
            </button>
          </div>
        </nav>
      )}

      {/* Native assistant bottom sheet */}
      {isMobile && sheetAction && (
        <div
          data-testid="x-thread-sheet"
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="Thread assistant"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeSheet}
            aria-hidden="true"
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl transition-[height] duration-200 motion-reduce:transition-none",
              sheetLevel === 0 && "h-[30vh]",
              sheetLevel === 1 && "h-[55vh]",
              sheetLevel === 2 && "h-[90vh]"
            )}
          >
            <div className="flex items-center justify-between px-4 pt-2">
              <div
                className="mx-auto flex h-1.5 w-10 cursor-grab rounded-full bg-border"
                aria-hidden="true"
              />
              <div className="flex items-center gap-1 pr-0">
                <button
                  onClick={() => setSheetLevel((l) => (l === 2 ? 2 : ((l + 1) as 0 | 1 | 2)))}
                  aria-label="Expand sheet"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <CaretUp size={14} />
                </button>
                <button
                  onClick={() => setSheetLevel((l) => (l === 0 ? 0 : ((l - 1) as 0 | 1 | 2)))}
                  aria-label="Collapse sheet"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <CaretDown size={14} />
                </button>
                <button
                  onClick={closeSheet}
                  aria-label="Close assistant"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                <NotePencil size={12} />
                Scope: This X thread
              </span>
              <span className="text-xs font-semibold capitalize text-foreground">
                {sheetAction === "summary" ? "Summary" : sheetAction === "insights" ? "Insights" : "Ask"}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {sheetLoading ? (
                <div className="space-y-2 pt-2" aria-label="Thinking">
                  <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              ) : sheetOutput?.error ? (
                <p className="pt-2 text-sm text-muted-foreground">{sheetOutput.error}</p>
              ) : sheetOutput?.text ? (
                <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed text-foreground">
                  {sheetOutput.text}
                </p>
              ) : null}
            </div>

            {sheetAction === "ask" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!askInput.trim() || sheetLoading) return;
                  void runSheetAction("ask");
                }}
                className="flex items-center gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
              >
                <input
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder="Ask about this thread…"
                  aria-label="Ask about this thread"
                  className="min-w-0 flex-1 rounded-full border border-border bg-muted/50 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                <button
                  type="submit"
                  disabled={!askInput.trim() || sheetLoading}
                  aria-label="Ask"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <PaperPlaneTilt size={16} weight="fill" />
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Selection action bar (desktop + mobile floating above the selection) */}
      {selection && thread && (
        <div
          data-testid="x-thread-selection-bar"
          className="fixed z-50 flex items-center gap-1 rounded-full border border-border bg-popover p-1 shadow-lg"
          style={{
            left: Math.max(8, Math.min(selection.rect.left + selection.rect.width / 2 - 150, window.innerWidth - 308)),
            top: Math.max(8, selection.rect.top - 52),
          }}
          role="toolbar"
          aria-label="Selection actions"
        >
          {[
            { label: "Extract", icon: <NotePencil size={14} />, action: extractSelection },
            { label: "Explain", icon: <Sparkle size={14} />, action: () => openSheet("ask") },
            { label: "Summarize", icon: <ListBullets size={14} />, action: () => openSheet("summary") },
            { label: "Flashcard", icon: <NotePencil size={14} />, action: () => onCreateFlashcard?.(selection.text, postProvenance(thread, selection.post)) },
            { label: "Copy", icon: <DotsThree size={14} />, action: () => { void navigator.clipboard?.writeText(selection.text).catch(() => undefined); clearSelection(); } },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
      <LanguageReaderDomBridge
        root={threadRoot}
        surface="html"
        sourceId={doc.id}
      />
    </div>
  );
}

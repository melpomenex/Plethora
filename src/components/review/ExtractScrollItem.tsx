import { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowCounterClockwise,
  ChatCircle,
  CheckCircle,
  CircleNotch,
  Clock,
  Eye,
  EyeSlash,
  PencilLine,
  Scissors,
  Sparkle,
  Star,
  TextT,
  Trophy,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  updateExtract,
  forgetExtract,
  dismissExtract,
  graduateExtract,
  type Extract,
} from "../../api/extracts";
import { generateProgressiveSummaries } from "../../api/ai";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { resolveExtractDisplay } from "../../lib/extractDisclosure";
import { cn } from "../../utils";
import { SESSION_CHROME_BOUNDS } from "../queue/SessionChromeHeader";
import { isEditableEventTarget } from "../queue/EndOfItemTriageBar";
import { useUIStore } from "../../stores/uiStore";
import { useDocumentStore } from "../../stores/documentStore";
import { GhostContextPeek } from "./GhostContextPeek";
import { renderMarkdown } from "../../utils/markdown";
import { useBreakoutOverlay } from "../viewer/BreakoutOverlayModal";

interface ExtractScrollItemProps {
    extract: Extract;
    documentTitle: string;
    parentContent?: string | null;
    onRate: (rating: number) => void;
    onCreateCloze: (selectedText: string, range: [number, number]) => void;
    onCreateQA: () => void;
    onCreateFlashcard?: (selectedText: string) => void;
    onUpdate?: (updates: { content: string; notes?: string }) => void;
}

/**
 * Full-screen extract component for scroll mode review.
 * Shows extract content, allows creating flashcards, and provides rating buttons.
 */
export function ExtractScrollItem({
    extract,
    documentTitle,
    parentContent,
    onRate,
    onCreateCloze,
    onCreateQA,
    onCreateFlashcard,
    onUpdate
}: ExtractScrollItemProps) {
    const { t } = useI18n();
    const densityMode = useUIStore((s) => s.densityMode);
    const storeParentContent = useDocumentStore(
        (s) => s.documents.find((d) => d.id === extract.document_id)?.content
    );
    const resolvedParentContent = parentContent !== undefined ? parentContent : storeParentContent;
    const [isPeekingContext, setIsPeekingContext] = useState(false);
    const overscrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Opt-in: progressive summaries are never generated (or shown) unless the
    // user asked for them in Settings → AI → Summarization.
    const summariesEnabled = useSettingsStore(
        (state) => state.settings.ai.aiControls.extractProgressiveSummaries
    );
    const [content, setContent] = useState(extract.content);
    const [notes, setNotes] = useState(extract.notes ?? "");
    const [saveStatus, setSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const proseRef = useRef<HTMLDivElement>(null);
    const { breakoutTrigger, breakoutModal } = useBreakoutOverlay(proseRef);
    const lastSavedRef = useRef({ content: extract.content, notes: extract.notes ?? "" });
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [summaryGenerationFinished, setSummaryGenerationFinished] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summaries, setSummaries] = useState(extract.progressive_summaries ?? []);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null);

    const formatDateTime = (dateStr?: string | Date) => {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        });
    };

    const hasBeenModified = useMemo(() => {
        const created = new Date(extract.date_created).getTime();
        const modified = new Date(extract.date_modified).getTime();
        return modified > created + 1000 || saveStatus === "saved";
    }, [extract.date_created, extract.date_modified, saveStatus]);

    // Generate progressive summaries on mount if needed — never unless the
    // user opted in.
    useEffect(() => {
        if (!summariesEnabled) return;
        if (
            extract.max_disclosure_level > 0 &&
            (!extract.progressive_summaries || extract.progressive_summaries.length === 0)
        ) {
            setIsGeneratingSummary(true);
            setSummaryError(null);
            generateProgressiveSummaries(extract.id)
                .then((result) => {
                    if (isMountedRef.current) {
                        setSummaries(result);
                    }
                })
                .catch((err) => {
                    console.error("Failed to generate progressive summaries:", err);
                    if (isMountedRef.current) {
                        setSummaryError(t("extractScrollItem.summaryError"));
                    }
                })
                .finally(() => {
                    if (isMountedRef.current) {
                        setIsGeneratingSummary(false);
                        setSummaryGenerationFinished(true);
                    }
                });
        }
    }, [extract.id, extract.max_disclosure_level, summariesEnabled, t]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        setContent(extract.content);
        setNotes(extract.notes ?? "");
        lastSavedRef.current = { content: extract.content, notes: extract.notes ?? "" };
        setSaveStatus("idle");
    }, [extract.id, extract.content, extract.notes]);

    // Keyboard shortcuts: 1-4 to rate, C for Cloze (Q is handled by EndOfItemTriageBar)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditableEventTarget(e.target) || isEditableEventTarget(document.activeElement)) {
                return;
            }

            if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                handleCreateCloze();
            } else if (e.key === "1") {
                onRate(1);
            } else if (e.key === "2") {
                onRate(2);
            } else if (e.key === "3") {
                onRate(3);
            } else if (e.key === "4") {
                onRate(4);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onRate, onCreateCloze]);

    // Bare Alt hold reveals GhostContextPeek; releasing Alt collapses it
    useEffect(() => {
        const handleAltDown = (e: KeyboardEvent) => {
            if (e.key === "Alt" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (isEditableEventTarget(e.target) || isEditableEventTarget(document.activeElement)) {
                    return;
                }
                setIsPeekingContext(true);
            }
        };
        const handleAltUp = (e: KeyboardEvent) => {
            if (e.key === "Alt") {
                setIsPeekingContext(false);
            }
        };
        const handleBlur = () => setIsPeekingContext(false);
        window.addEventListener("keydown", handleAltDown);
        window.addEventListener("keyup", handleAltUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleAltDown);
            window.removeEventListener("keyup", handleAltUp);
            window.removeEventListener("blur", handleBlur);
            if (overscrollTimerRef.current) {
                clearTimeout(overscrollTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (content === lastSavedRef.current.content && notes === lastSavedRef.current.notes) {
            return;
        }

        setSaveStatus("dirty");

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            setSaveStatus("saving");
            try {
                await updateExtract({ id: extract.id, content, note: notes });
                if (!isMountedRef.current) return;
                lastSavedRef.current = { content, notes };
                onUpdate?.({ content, notes });
                setSaveStatus("saved");
                if (statusTimeoutRef.current) {
                    clearTimeout(statusTimeoutRef.current);
                }
                statusTimeoutRef.current = setTimeout(() => {
                    if (isMountedRef.current) {
                        setSaveStatus("idle");
                    }
                }, 2000);
            } catch (error) {
                if (!isMountedRef.current) return;
                console.error("Failed to save extract edits:", error);
                setSaveStatus("error");
            }
        }, 800);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [content, notes, extract.id, onUpdate]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (statusTimeoutRef.current) {
                clearTimeout(statusTimeoutRef.current);
            }
        };
    }, []);

    const display = resolveExtractDisplay({
        content,
        maxLevel: extract.max_disclosure_level,
        currentLevel: extract.progressive_disclosure_level,
        summaries,
        summariesEnabled,
        isGenerating: isGeneratingSummary,
        hasError: summaryError !== null,
        generationFinished: summaryGenerationFinished,
    });

    const contentLevelLabel =
        display.kind === "summary" && display.stage !== null
            ? t("extractScrollItem.aiSummaryLevel", {
                  current: display.stage,
                  total: extract.max_disclosure_level,
              })
            : display.kind === "partial" && display.fraction !== null
              ? t("extractScrollItem.revealingPercent", {
                    count: Math.round(display.fraction * 100),
                })
              : display.kind === "full" && display.stage !== null
                ? t("extractScrollItem.fullContent")
                : null;

    const handleCreateCloze = () => {
        const textarea = contentRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        if (start === end) return;

        const selectedText = textarea.value.slice(start, end).trim();
        if (!selectedText) return;

        onCreateCloze(selectedText, [start, end]);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const textarea = contentRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        const selectedText = textarea.value.slice(start, end).trim();
        if (!selectedText) return;
        setContextMenu({ x: e.clientX, y: e.clientY, selectedText });
    };

    const stateLabel = extract.review_count === 0
        ? t("extractScrollItem.newExtract")
        : t("extractScrollItem.review");

    const renderSaveStatus = () => {
        if (saveStatus === "saving") {
            return (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                    {t("extractScrollItem.saving")}
                </span>
            );
        }
        if (saveStatus === "saved") {
            return (
                <span className="flex items-center gap-2 text-xs text-emerald-500">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t("extractScrollItem.saved")}
                </span>
            );
        }
        if (saveStatus === "error") {
            return (
                <span className="flex items-center gap-2 text-xs text-red-500">
                    <WarningCircle className="w-3.5 h-3.5" />
                    {t("extractScrollItem.saveFailed")}
                </span>
            );
        }
        if (saveStatus === "dirty") {
            return (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PencilLine className="w-3.5 h-3.5" />
                    {t("extractScrollItem.unsaved")}
                </span>
            );
        }
        return null;
    };

    return (
        <div
            data-extract-scroll-surface="true"
            className={cn(
                "h-full w-full flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30 overflow-y-auto",
                SESSION_CHROME_BOUNDS.SAFE_CONTENT_CLASS
            )}
        >
            {/* Extract Container */}
            <div className="w-full max-w-4xl flex flex-col gap-6">
                {/* Header: badges + document title (in-flow, occupies its own space above the content) */}
                <div className="w-full flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium flex items-center gap-2">
                            <TextT className="w-4 h-4" />
                            {t("extractScrollItem.extract")}
                        </span>
                        <span className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium">
                            {stateLabel}
                        </span>
                        {extract.review_count > 0 && (
                            <span className="px-2 py-1 text-xs text-muted-foreground">
                                {t("extractScrollItem.reviewedCount", { count: extract.review_count })}
                            </span>
                        )}
                        {display.stage !== null && (
                            <span className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                                <Eye className="w-3 h-3" />
                                {t("extractScrollItem.level", { current: display.stage, total: extract.max_disclosure_level })}
                            </span>
                        )}
                        {densityMode === "architect" && (
                            <div
                                data-architect-telemetry="true"
                                className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                            >
                                <span>P{extract.priority_slider ?? 50}</span>
                                <span>S {extract.memory_state?.stability !== undefined ? `${extract.memory_state.stability.toFixed(1)}d` : "—"}</span>
                                <span>D {extract.memory_state?.difficulty !== undefined ? extract.memory_state.difficulty.toFixed(1) : "—"}</span>
                                <span>Reviews {extract.review_count}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-4 max-w-md min-w-0 text-sm text-muted-foreground">
                        <span className="truncate" title={documentTitle}>
                            {t("extractScrollItem.from")} <span className="font-medium text-foreground">{documentTitle}</span>
                            {extract.page_number && <span className="ml-2 opacity-70">{t("extractScrollItem.pageShort", { count: extract.page_number })}</span>}
                        </span>
                        {renderSaveStatus()}
                    </div>
                </div>

                {/* Actions Bar */}
                <div className="flex items-center justify-end gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setIsPeekingContext((prev) => !prev)}
                        aria-pressed={isPeekingContext}
                        className="px-3 py-2 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg font-medium text-xs flex items-center gap-1.5 border border-border/60 transition-colors"
                    >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Peek Context (Alt)</span>
                    </button>
                    {onCreateFlashcard && (
                        <button
                            onClick={() => onCreateFlashcard(extract.content)}
                            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-sm flex items-center gap-2 transition-colors shadow-sm"
                            title={t("extractScrollItem.createFlashcardHint")}
                        >
                            <Sparkle className="w-4 h-4" />
                            {t("extractScrollItem.createFlashcard")}
                        </button>
                    )}
                    <button
                        onClick={handleCreateCloze}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                        title={t("extractScrollItem.createClozeHint")}
                    >
                        <Scissors className="w-4 h-4" />
                        {t("extractScrollItem.createCloze")}
                    </button>
                    <button
                        onClick={onCreateQA}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                        title={t("extractScrollItem.createQaHint")}
                    >
                        <ChatCircle className="w-4 h-4" />
                        {t("extractScrollItem.createQa")}
                    </button>
                </div>

                <GhostContextPeek
                    isPeeking={isPeekingContext}
                    documentTitle={documentTitle}
                    parentContent={resolvedParentContent}
                    extractText={content}
                />

                {/* Content Editor / Progressive Disclosure */}
                <div
                    data-extract-scroll="true"
                    onWheel={(e) => {
                        if (e.currentTarget.scrollTop <= 0 && e.deltaY < -35) {
                            setIsPeekingContext(true);
                            if (overscrollTimerRef.current) {
                                clearTimeout(overscrollTimerRef.current);
                            }
                            overscrollTimerRef.current = setTimeout(() => {
                                setIsPeekingContext(false);
                            }, 2500);
                        } else if (e.deltaY > 10 && isPeekingContext) {
                            setIsPeekingContext(false);
                        }
                    }}
                    className="bg-card border border-border rounded-2xl shadow-xl min-h-[300px] max-h-[60vh] overflow-y-auto relative"
                >
                    {display.kind === "full" && (
                        <>
                            {contentLevelLabel && (
                                <div className="absolute top-3 right-3 z-10 px-3 py-1 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-400">
                                    {contentLevelLabel}
                                </div>
                            )}
                            <textarea
                                ref={contentRef}
                                value={content}
                                onChange={(event) => setContent(event.target.value)}
                                placeholder={t("extractScrollItem.editContentPlaceholder")}
                                className="w-full min-h-[300px] p-10 bg-transparent text-lg leading-relaxed text-foreground outline-none resize-none"
                                onContextMenu={handleContextMenu}
                            />
                        </>
                    )}

                    {display.kind === "loading" && (
                        <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground gap-3">
                            <CircleNotch className="w-6 h-6 animate-spin" />
                            <span className="text-sm">{t("extractScrollItem.generatingSummary")}</span>
                        </div>
                    )}

                    {display.kind === "error" && (
                        <div className="p-10">
                            <div className="text-xs text-amber-400 mb-2">{summaryError}</div>
                            <textarea
                                ref={contentRef}
                                value={content}
                                onChange={(event) => setContent(event.target.value)}
                                placeholder={t("extractScrollItem.editContentPlaceholder")}
                                className="w-full min-h-[300px] bg-transparent text-lg leading-relaxed text-foreground outline-none resize-none"
                                onContextMenu={handleContextMenu}
                            />
                        </div>
                    )}

                    {(display.kind === "summary" || display.kind === "partial") && (
                        <>
                            {contentLevelLabel && (
                                <div className={cn(
                                    "absolute top-3 right-3 z-10 px-3 py-1 rounded-lg text-xs font-medium",
                                    display.kind === "summary"
                                        ? "bg-amber-500/20 text-amber-400"
                                        : "bg-blue-500/20 text-blue-400"
                                )}>
                                    {display.kind === "summary" && <Sparkle className="w-3 h-3 inline mr-1" />}
                                    {contentLevelLabel}
                                </div>
                            )}
                            <div
                                ref={proseRef}
                                className="p-10 text-lg leading-relaxed text-foreground prose prose-lg dark:prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(display.text) }}
                            />
                            {breakoutTrigger}
                            {breakoutModal}
                        </>
                    )}

                        {hasBeenModified && (
                            <div 
                                className="absolute bottom-4 right-4 flex items-center gap-1.5 px-2.5 py-1 bg-muted/80 backdrop-blur-sm border border-border rounded-lg text-xs text-muted-foreground cursor-help select-none hover:text-foreground hover:bg-muted transition-all shadow-sm z-20 pointer-events-auto"
                                title={`Last edited: ${formatDateTime(extract.date_modified)}\nCreated: ${formatDateTime(extract.date_created)}`}
                            >
                                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                                <span>Edited</span>
                            </div>
                        )}
                    </div>

                {/* Notes Editor */}
                <div className={cn(
                    "bg-muted/50 border border-border/50 rounded-xl p-4",
                    "text-sm text-muted-foreground"
                )}>
                    <div className="font-semibold text-xs uppercase tracking-wider mb-2 opacity-70">{t("extractScrollItem.notes")}</div>
                    <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder={t("extractScrollItem.notesPlaceholder")}
                        className="w-full min-h-[90px] bg-transparent text-sm text-foreground outline-none resize-none"
                    />
                </div>

                {/* Lifecycle actions: Forget / Dismiss / Done */}
                <div className="flex items-center justify-center gap-2 mt-3">
                    <button
                        onClick={() => {
                            void forgetExtract(extract.id).then(() => onRate(1));
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                        title="Reset memory state and return to new queue"
                    >
                        <ArrowCounterClockwise className="w-3.5 h-3.5" />
                        Forget
                    </button>
                    <button
                        onClick={() => {
                            void dismissExtract(extract.id, !extract.is_dismissed).then(() => onRate(3));
                        }}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                            extract.is_dismissed
                                ? "border-primary/40 text-primary bg-primary/10"
                                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        title={extract.is_dismissed ? "Restore to review queue" : "Remove from review queue (keep in library)"}
                    >
                        <EyeSlash className="w-3.5 h-3.5" />
                        {extract.is_dismissed ? "Undismiss" : "Dismiss"}
                    </button>
                    <button
                        onClick={() => {
                            void graduateExtract(extract.id).then(() => onRate(4));
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                        title="Mark mastered — schedule ~5 years out"
                    >
                        <Trophy className="w-3.5 h-3.5" />
                        Done
                    </button>
                </div>

                {/* Rating Buttons */}
                <div className="flex items-center justify-center gap-4 mt-2">
                    <button
                        onClick={() => onRate(1)}
                        className="flex-1 py-4 bg-red-500/90 text-white rounded-xl font-medium hover:bg-red-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                    >
                        <WarningCircle className="w-5 h-5" />
                        {t("extractScrollItem.again")}
                    </button>
                    <button
                        onClick={() => onRate(2)}
                        className="flex-1 py-4 bg-orange-500/90 text-white rounded-xl font-medium hover:bg-orange-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                    >
                        <Star className="w-5 h-5" />
                        {t("extractScrollItem.hard")}
                    </button>
                    <button
                        onClick={() => onRate(3)}
                        className="flex-1 py-4 bg-blue-500/90 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                    >
                        <CheckCircle className="w-5 h-5" />
                        {t("extractScrollItem.good")}
                    </button>
                    <button
                        onClick={() => onRate(4)}
                        className="flex-1 py-4 bg-green-500/90 text-white rounded-xl font-medium hover:bg-green-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                    >
                        <Sparkle className="w-5 h-5" />
                        {t("extractScrollItem.easy")}
                    </button>
                </div>

                {/* Keyboard hints */}
                <div className="text-center text-xs text-muted-foreground">
                    {t("extractScrollItem.keyboardHints")}
                </div>
            </div>

            {/* Right-click context menu */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-[9999]" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
                    <div
                        className="fixed z-[10000] bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        {onCreateCloze && (
                            <button
                                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                                onClick={() => {
                                    setContextMenu(null);
                                    onCreateCloze(contextMenu.selectedText, [0, 0]);
                                }}
                            >
                                <Scissors className="w-4 h-4 text-muted-foreground" />
                                {t("extractScrollItem.createCloze")}
                            </button>
                        )}
                        {onCreateQA && (
                            <button
                                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                                onClick={() => {
                                    setContextMenu(null);
                                    onCreateQA();
                                }}
                            >
                                <ChatCircle className="w-4 h-4 text-muted-foreground" />
                                {t("extractScrollItem.createQa")}
                            </button>
                        )}
                        {onCreateFlashcard && (
                            <button
                                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                    onCreateFlashcard(contextMenu.selectedText);
                                }}
                            >
                                <Sparkle className="w-4 h-4 text-muted-foreground" />
                                {t("extractScrollItem.createFlashcard")}
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

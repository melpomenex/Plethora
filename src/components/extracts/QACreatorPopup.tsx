import { useState, useEffect, useRef } from "react";
import { ChatCircle, Check, ClipboardText, X } from "@phosphor-icons/react";
import { createQAFromExtract } from "../../api/extract-review";
import { createLearningItem, type LearningItem } from "../../api/learning-items";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";
import {
    GracefulAiFallbackCard,
    type AiFailureKind,
} from "../common/GracefulAiFallbackCard";

export interface DockedCreatorExtensionProps {
    mode?: "docked" | "modal";
    dockPosition?: "right" | "bottom";
    onGrabSelection?: () => string | null;
}

interface QACreatorPopupProps extends DockedCreatorExtensionProps {
    extractId?: string;
    documentId?: string;
    aiFailure?: { kind: AiFailureKind; message?: string; quote?: string } | null;
    onRetryAiSmallerContext?: (contextScale: number) => void;
    onCreated: (item: LearningItem) => void;
    onCancel: () => void;
}

export function QACreatorPopup({
    extractId,
    documentId,
    mode = "modal",
    dockPosition = "right",
    onGrabSelection,
    aiFailure,
    onRetryAiSmallerContext,
    onCreated,
    onCancel,
}: QACreatorPopupProps) {
    const { t } = useI18n();
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTargetField, setActiveTargetField] = useState<"question" | "answer">("question");
    const questionRef = useRef<HTMLTextAreaElement>(null);

    const grabSelectionText = (): string => {
        const custom = onGrabSelection?.();
        if (custom && custom.trim()) return custom.trim();
        if (typeof window !== "undefined") {
            return window.getSelection()?.toString().trim() ?? "";
        }
        return "";
    };

    const handleInsertSelection = (targetField: "question" | "answer" = activeTargetField) => {
        const grabbed = grabSelectionText();
        if (!grabbed) return;
        if (targetField === "question") {
            setQuestion((prev) => (prev.trim() ? `${prev.trimEnd()}\n${grabbed}` : grabbed));
        } else {
            setAnswer((prev) => (prev.trim() ? `${prev.trimEnd()}\n${grabbed}` : grabbed));
        }
    };

    const handleSubmit = async () => {
        if (!question.trim() || !answer.trim() || isSubmitting) return;

        setIsSubmitting(true);
        try {
            const item = extractId
                ? await createQAFromExtract(extractId, question, answer)
                : await createLearningItem({
                      document_id: documentId,
                      item_type: "Qa",
                      question,
                      answer,
                  });
            onCreated(item);
        } catch (error) {
            console.error("Failed to create QA:", error);
            setIsSubmitting(false);
        }
    };

    const handleSubmitRef = useRef(handleSubmit);
    handleSubmitRef.current = handleSubmit;
    const onCancelRef = useRef(onCancel);
    onCancelRef.current = onCancel;

    useEffect(() => {
        // Focus question on mount only
        questionRef.current?.focus();
    }, []);

    useEffect(() => {
        // Escape to close, Ctrl+Enter to submit
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onCancelRef.current();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                handleSubmitRef.current();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const isDocked = mode === "docked";

    return (
        <div
            className={cn(
                isDocked
                    ? cn(
                          "fixed z-40 pointer-events-none flex p-4",
                          dockPosition === "bottom"
                              ? "inset-x-0 bottom-0 justify-center"
                              : "inset-x-0 bottom-0 justify-center lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:justify-end lg:items-center"
                      )
                    : "fixed inset-0 z-50 flex items-center justify-center p-4"
            )}
        >
            {!isDocked && (
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={onCancel}
                />
            )}

            <div
                data-split-sheet="true"
                data-creator-mode={mode}
                onKeyDown={(e) => {
                    const isToggleCombo =
                        (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "q";
                    if (e.key !== "Escape" && !isToggleCombo) {
                        e.stopPropagation();
                    }
                }}
                className={cn(
                    "pointer-events-auto relative bg-card border border-border rounded-xl shadow-2xl flex flex-col",
                    isDocked
                        ? dockPosition === "bottom"
                            ? "w-full max-w-3xl max-h-[380px]"
                            : "w-full max-w-3xl max-h-[380px] lg:w-[min(420px,92vw)] lg:max-h-[90vh]"
                        : "w-full max-w-2xl max-h-[90vh]"
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <ChatCircle className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">{t("extracts.createQACard")}</h3>
                            <p className="text-sm text-muted-foreground">{t("extracts.createQADesc")}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label={t("common.cancel")}
                        className="p-2 hover:bg-muted rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col gap-6 overflow-y-auto">
                    {aiFailure && (
                        <GracefulAiFallbackCard
                            errorKind={aiFailure.kind}
                            preservedQuote={aiFailure.quote}
                            preservedPrompt={question}
                            errorMessage={aiFailure.message}
                            onFallbackManual={() => questionRef.current?.focus()}
                            onRetrySmallerContext={(scale) => onRetryAiSmallerContext?.(scale)}
                        />
                    )}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-sm font-medium text-foreground">{t("review.question")}</label>
                            <button
                                type="button"
                                onClick={() => handleInsertSelection("question")}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                                <ClipboardText className="w-3.5 h-3.5" />
                                Insert Selection into Question
                            </button>
                        </div>
                        <textarea
                            ref={questionRef}
                            value={question}
                            onFocus={() => setActiveTargetField("question")}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="Enter your question here..."
                            className="w-full min-h-[100px] p-4 bg-muted/30 border border-input rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-sm font-medium text-foreground">{t("review.answer")}</label>
                            <button
                                type="button"
                                onClick={() => handleInsertSelection("answer")}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                                <ClipboardText className="w-3.5 h-3.5" />
                                Insert Selection into Answer
                            </button>
                        </div>
                        <textarea
                            value={answer}
                            onFocus={() => setActiveTargetField("answer")}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Enter the answer..."
                            className="w-full min-h-[150px] p-4 bg-muted/30 border border-input rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border bg-muted/10 rounded-b-xl flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Ctrl+Enter</span> {t("extracts.toSave")}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                        >
                            {t("common.cancel")}
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!question.trim() || !answer.trim() || isSubmitting}
                            className={cn(
                                "px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-primary/20 transition-all",
                                (!question.trim() || !answer.trim() || isSubmitting) && "opacity-50 cursor-not-allowed shadow-none"
                            )}
                        >
                            <Check className="w-4 h-4" />
                            {isSubmitting ? t("extracts.creating") : t("extracts.createCardBtn")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

import { emitUserInteraction } from "../../lib/feedback/orchestrator";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ChatCircle,
  CheckCircle,
  Eye,
  Pencil,
  Scissors,
  Sparkle,
  Star,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import type { LearningItem } from "../../api/learning-items";
import { FLASHCARD_REVEAL_EVENT } from "../../pages/queueScrollKeyboard";
import { cn } from "../../utils";
import { warmAnkiLatexNormalization } from "../../utils/ankiLatex";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { isClozeCardType, hasRawClozeSyntax } from "../../utils/cloze";
import { isOcclusionCard } from "../../utils/occlusion";
import { SixGradeRatingControl } from "./SixGradeRatingControl";
import { ReviewCardContent } from "./ReviewCardContent";
import {
  gradeToRating,
  useRatingSchema,
  type SixGrade,
} from "../../lib/rating-grades";

interface FlashcardScrollItemProps {
    learningItem: LearningItem;
    onRate: (rating: number, grade?: number) => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onCreateFlashcard?: (excerpt: string, extractId?: string, documentId?: string) => void;
    onCreateCloze?: (selectedText: string, range: [number, number]) => void;
    onCreateQA?: () => void;
    /** Fired whenever the answer reveal state changes (used by Scroll Mode to
     *  gate its global 1-4 rating keys on the same "reveal first" rule the
     *  card's own rating buttons follow). */
    onRevealChange?: (revealed: boolean) => void;
}

/**
 * Full-screen flashcard component for scroll mode review.
 * Shows question, allows revealing answer, and provides rating buttons.
 */
export const FlashcardScrollItem = React.memo(function FlashcardScrollItem({ 
    learningItem, 
    onRate, 
    onEdit,
    onDelete,
    onCreateFlashcard,
    onCreateCloze,
    onCreateQA,
    onRevealChange
}: FlashcardScrollItemProps) {
    const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
    const { click } = useHapticFeedback();
    const containerRef = useRef<HTMLDivElement>(null);
    // Six-grade schedulers (Adaptive/Precision) rate on the native 0-5
    // scale — same shared control, keyboard mapping, and touch joystick as
    // the review session.
    const ratingSchema = useRatingSchema();
    const useNativeGrades = ratingSchema.type === "six-grade";
    const isClozeCard = isClozeCardType(learningItem) || Boolean(learningItem.cloze_text) || hasRawClozeSyntax(learningItem.question || "");
    const isOcclusion = isOcclusionCard(learningItem);
    const hasAnswerSection = Boolean(
        (learningItem.answer && (!isClozeCard || !learningItem.question?.includes(learningItem.answer))) ||
        isOcclusion
    );
    const isAnswerRevealedRef = useRef(isAnswerRevealed);
    isAnswerRevealedRef.current = isAnswerRevealed;

    const revealAnswer = () => {
        if (!isAnswerRevealedRef.current) {
            isAnswerRevealedRef.current = true;
            setIsAnswerRevealed(true);
            emitUserInteraction("review.answer-revealed");
        }
    };

    const handleCreateCloze = () => {
        if (!onCreateCloze) return;
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";
        if (!selectedText) return;

        const questionText = learningItem.question;
        const start = questionText.indexOf(selectedText);
        const end = start + selectedText.length;
        if (start !== -1) {
            onCreateCloze(selectedText, [start, end]);
        } else {
            onCreateCloze(selectedText, [0, 0]);
        }
    };

    // Keyboard shortcuts: Space to reveal, 1-4 to rate, C for Cloze, Q for QA, Cmd+E to edit
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger if typing in input
            if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
                return;
            }
            if (containerRef.current && e.target instanceof Node && !containerRef.current.contains(e.target)) return;

            // Cmd+E / Ctrl+E to edit card
            if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
                if (onEdit) {
                    e.preventDefault();
                    onEdit();
                    return;
                }
            }

            // Space or Enter to reveal answer
            if ((e.key === " " || e.key === "Enter") && !isAnswerRevealed) {
                e.preventDefault();
                revealAnswer();
            }

            if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                handleCreateCloze();
            } else if (e.key === "q" || e.key === "Q") {
                if (onCreateQA) {
                    e.preventDefault();
                    onCreateQA();
                }
            }

            // Number keys to rate (only when answer is revealed): 0-5 native
            // grades under six-grade schedulers, 1-4 otherwise.
            if (isAnswerRevealed) {
                if (useNativeGrades && /^[0-5]$/.test(e.key)) {
                    e.preventDefault();
                    click();
                    const grade = Number(e.key) as SixGrade;
                    onRate(gradeToRating(grade), grade);
                } else if (e.key === "1") {
                    e.preventDefault();
                    click();
                    onRate(1);
                } else if (e.key === "2") {
                    e.preventDefault();
                    click();
                    onRate(2);
                } else if (e.key === "3") {
                    e.preventDefault();
                    click();
                    onRate(3);
                } else if (e.key === "4") {
                    e.preventDefault();
                    click();
                    onRate(4);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isAnswerRevealed, onRate, onCreateQA, learningItem.question, useNativeGrades]);

    // Report the reveal state to the parent (Scroll Mode gates its global 1-4
    // rating shortcuts on it). Runs on mount (revealed=false) and whenever the
    // answer is shown or hidden.
    useEffect(() => {
        onRevealChange?.(isAnswerRevealed);
    }, [isAnswerRevealed, onRevealChange]);

    // Reveal the answer when the scroll page requests it (Space pressed while
    // focus is outside the card). The card's own key handler is scoped to
    // focus inside its container; Scroll Mode drives the reveal through this
    // window-event bridge instead (see queueScrollKeyboard.ts).
    useEffect(() => {
        const handleRevealRequest = revealAnswer;
        window.addEventListener(FLASHCARD_REVEAL_EVENT, handleRevealRequest);
        return () => window.removeEventListener(FLASHCARD_REVEAL_EVENT, handleRevealRequest);
    }, []);

    useEffect(() => {
        warmAnkiLatexNormalization([learningItem.question, learningItem.answer, learningItem.cloze_text]);
    }, [learningItem.question, learningItem.answer, learningItem.cloze_text]);

    const stateLabel = learningItem.state === "New"
        ? "New Card"
        : learningItem.state === "Learning"
            ? "Learning"
            : learningItem.state === "Review"
                ? "Review"
                : "Relearning";

    return (
        <div data-paper-surface="inset" ref={containerRef} className="h-full w-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-background to-muted/30">
            {/* Card Type Badge */}
            <div className="absolute top-6 left-6 flex items-center gap-2">
                <span className="px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium">
                    {learningItem.item_type}
                </span>
                <span className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium">
                    {stateLabel}
                </span>
                {learningItem.review_count > 0 && (
                    <span className="px-2 py-1 text-xs text-muted-foreground">
                        Reviewed {learningItem.review_count}x
                    </span>
                )}
            </div>

            {/* Top Right Controls */}
            {(onEdit || onDelete) && (
                <div className="absolute top-6 right-6 flex items-center gap-2">
                    {onEdit && (
                        <button
                            onClick={onEdit}
                            data-testid="review-card-edit"
                            className="p-2 rounded-lg bg-card/80 border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                            title="Edit Flashcard (Cmd+E / Ctrl+E)"
                            aria-label="Edit Flashcard"
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            data-testid="review-card-delete"
                            className="p-2 rounded-lg bg-card/80 border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shadow-sm"
                            title="Delete Flashcard"
                            aria-label="Delete Flashcard"
                        >
                            <Trash className="w-4 h-4" />
                        </button>
                    )}
                </div>
            )}

            {/* Flashcard Container */}
            <div className="w-full max-w-3xl">
                {/* Actions Bar */}
                {(onCreateFlashcard || onCreateCloze || onCreateQA) && (learningItem.tags?.includes("kindle") || learningItem.extract_id) && (
                    <div className="flex items-center justify-center gap-3 mb-5 pointer-events-auto">
                        {onCreateFlashcard && (
                            <button
                                onClick={() => onCreateFlashcard(learningItem.question, learningItem.extract_id, learningItem.document_id)}
                                className="px-4 py-2 bg-purple-600/10 dark:bg-purple-600/20 hover:bg-purple-600/20 dark:hover:bg-purple-600/30 text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-all shadow-sm border border-purple-300 dark:border-purple-500/30 hover:border-purple-500"
                                title="Turn this highlight into real flashcards (Cloze, Q&A, etc.)"
                            >
                                <Sparkle className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                <span>Create Flashcard...</span>
                            </button>
                        )}
                        {onCreateCloze && (
                            <button
                                onClick={handleCreateCloze}
                                className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium text-sm flex items-center gap-2 transition-all shadow-sm border border-border"
                                title="Select text in the highlight and click here or press 'C' to create a Cloze deletion card"
                            >
                                <Scissors className="w-4 h-4 text-muted-foreground" />
                                <span>Create Cloze (C)</span>
                            </button>
                        )}
                        {onCreateQA && (
                            <button
                                onClick={onCreateQA}
                                className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium text-sm flex items-center gap-2 transition-all shadow-sm border border-border"
                                title="Click here or press 'Q' to create a Question & Answer card from this highlight"
                            >
                                <ChatCircle className="w-4 h-4 text-muted-foreground" />
                                <span>Create Q&A (Q)</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Question */}
                <div className="bg-card border border-border rounded-2xl p-8 shadow-xl mb-6">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-4">
                        Question
                    </div>
                    <ReviewCardContent
                        card={learningItem}
                        showAnswer={isAnswerRevealed}
                        part="question"
                        variant="scroll"
                    />
                </div>

                {/* Answer Section */}
                {hasAnswerSection && (
                    <div
                        className={cn(
                            "bg-card border border-border rounded-2xl p-8 shadow-xl transition-all duration-300",
                            isAnswerRevealed ? "opacity-100" : "opacity-0 pointer-events-none h-0 p-0 overflow-hidden"
                        )}
                    >
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-4">
                            Answer
                        </div>
                        <ReviewCardContent
                            card={learningItem}
                            showAnswer={isAnswerRevealed}
                            part="answer"
                            variant="scroll"
                        />
                    </div>
                )}

                {/* Show Answer Button */}
                {!isAnswerRevealed && (
                    <button
                        onClick={revealAnswer}
                        className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-medium text-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-3 shadow-lg"
                    >
                        <Eye className="w-5 h-5" />
                        Show Answer
                    </button>
                )}

                {/* Rating Buttons - show after answer is revealed */}
                {isAnswerRevealed && useNativeGrades && (
                    <div className="mt-6">
                        <SixGradeRatingControl
                            onSelect={(rating, grade) => { click(); onRate(rating, grade); }}
                            enabled={() => isAnswerRevealedRef.current}
                            touchAreaRef={containerRef}
                        />
                    </div>
                )}
                {isAnswerRevealed && !useNativeGrades && (
                    <div className="flex items-center justify-center gap-4 mt-6">
                        <button
                            onClick={() => { click(); onRate(1); }}
                            className="flex-1 py-4 bg-red-500/90 text-white rounded-xl font-medium hover:bg-red-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                        >
                            <WarningCircle className="w-5 h-5" />
                            Again
                        </button>
                        <button
                            onClick={() => { click(); onRate(2); }}
                            className="flex-1 py-4 bg-orange-500/90 text-white rounded-xl font-medium hover:bg-orange-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                        >
                            <Star className="w-5 h-5" />
                            Hard
                        </button>
                        <button
                            onClick={() => { click(); onRate(3); }}
                            className="flex-1 py-4 bg-blue-500/90 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                        >
                            <CheckCircle className="w-5 h-5" />
                            Good
                        </button>
                        <button
                            onClick={() => { click(); onRate(4); }}
                            className="flex-1 py-4 bg-green-500/90 text-white rounded-xl font-medium hover:bg-green-500 transition-colors flex items-center justify-center gap-2 shadow-lg"
                        >
                            <Sparkle className="w-5 h-5" />
                            Easy
                        </button>
                    </div>
                )}

                {/* Keyboard hints */}
                <div className="mt-8 text-center text-xs text-muted-foreground">
                    {!isAnswerRevealed ? (
                        "Press Space to reveal answer"
                    ) : useNativeGrades ? (
                        "Press 0-5 to grade • 0-2 fail, 3-5 pass"
                    ) : (
                        "Press 1-4 to rate • 1=Again, 2=Hard, 3=Good, 4=Easy"
                    )}
                </div>
            </div>
        </div>
    );
});

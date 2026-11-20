import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChatCircleText,
  CircleNotch,
  PaperPlaneRight,
  Quotes,
  Sparkle,
  Cards,
  X,
  Square,
} from "@phosphor-icons/react";
import { answerQuestion } from "../../api/ai";
import {
  GracefulAiFallbackCard,
  classifyAiError,
  type AiFailureKind,
} from "../common/GracefulAiFallbackCard";
import { useI18n } from "../../lib/i18n";

const CHAT_STATUS_KEYS = {
  preparing: "assistant.chatStatus.preparing",
  sources: "assistant.chatStatus.sources",
  model: "assistant.chatStatus.model",
  tools: "assistant.chatStatus.tools",
  validation: "assistant.chatStatus.validation",
} as const;

export interface SocraticMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  promptUsed?: string;
}

export interface SocraticMarginThreadProps {
  isOpen: boolean;
  documentId: string;
  selectedText: string;
  onClose: () => void;
  onConvertToExtract: (payload: { content: string; notes?: string }) => Promise<void> | void;
  onConvertToFlashcard: (payload: { question: string; answer: string }) => Promise<void> | void;
}

const QUICK_PROMPTS = [
  "Explain simply",
  "Why does this matter?",
  "Give a concrete example",
];

export function SocraticMarginThread({
  isOpen,
  documentId,
  selectedText,
  onClose,
  onConvertToExtract,
  onConvertToFlashcard,
}: SocraticMarginThreadProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<SocraticMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingStage, setPendingStage] = useState<"preparing" | "sources" | "model" | "tools" | "validation">();
  const [aiFailure, setAiFailure] = useState<{
    kind: AiFailureKind;
    message: string;
    prompt: string;
  } | null>(null);
  const [convertedIds, setConvertedIds] = useState<Record<string, "extract" | "flashcard">>({});
  const attemptRef = useRef(0);
  const activePromptRef = useRef("");
  const { t } = useI18n();

  useEffect(() => {
    attemptRef.current += 1;
    setIsLoading(false);
    setPendingStage(undefined);
  }, [documentId, selectedText]);

  useEffect(() => () => { attemptRef.current += 1; }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const stopReply = () => {
    attemptRef.current += 1;
    setIsLoading(false);
    setPendingStage(undefined);
    if (activePromptRef.current) setPrompt(activePromptRef.current);
  };

  const submitPrompt = async (questionText: string, contextScale = 1.0) => {
    const trimmed = questionText.trim();
    if (!trimmed || isLoading) return;
    setAiFailure(null);
    const userMsg: SocraticMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setIsLoading(true);
    const attemptId = ++attemptRef.current;
    activePromptRef.current = trimmed;
    setPendingStage("preparing");
    try {
      const scaledQuote =
        contextScale < 1 && selectedText.length > 0
          ? selectedText.slice(0, Math.max(1, Math.floor(selectedText.length * contextScale)))
          : selectedText;
      setPendingStage("model");
      const answer = await answerQuestion(trimmed, scaledQuote);
      if (attemptRef.current !== attemptId) return;
      const assistantMsg: SocraticMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: answer,
        promptUsed: trimmed,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (attemptRef.current !== attemptId) return;
      const message =
        err instanceof Error
          ? err.message
          : "AI assistant unavailable. Your quote and question are preserved below.";
      setAiFailure({
        kind: classifyAiError(err),
        message,
        prompt: trimmed,
      });
      setPrompt(trimmed);
    } finally {
      if (attemptRef.current === attemptId) {
        setIsLoading(false);
        setPendingStage(undefined);
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitPrompt(prompt);
  };

  const handleConvertExtract = async (msg: SocraticMessage) => {
    await onConvertToExtract({
      content: `${msg.text}\n\n> ${selectedText}`,
      notes: msg.promptUsed ? `Socratic prompt: ${msg.promptUsed}` : undefined,
    });
    setConvertedIds((prev) => ({ ...prev, [msg.id]: "extract" }));
  };

  const handleConvertFlashcard = async (msg: SocraticMessage) => {
    await onConvertToFlashcard({
      question: msg.promptUsed || `Explain: ${selectedText.slice(0, 80)}`,
      answer: msg.text,
    });
    setConvertedIds((prev) => ({ ...prev, [msg.id]: "flashcard" }));
  };

  return (
    <aside
      data-socratic-margin="true"
      data-split-sheet="true"
      aria-label="Socratic Margin Thread"
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed right-4 top-20 bottom-6 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-card text-foreground shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ChatCircleText className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Socratic Margin</h3>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ⌘J
          </kbd>
        </div>
        <button
          type="button"
          onClick={() => { stopReply(); onClose(); }}
          aria-label="Close Socratic Margin"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
          <Quotes className="h-3.5 w-3.5 text-primary" />
          <span>Anchored Selection</span>
        </div>
        <p className="line-clamp-3 italic">
          {selectedText || "Highlight text in the reader to anchor a question."}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Ask a follow-up question or pick a Socratic starter:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp}
                  type="button"
                  onClick={() => void submitPrompt(qp)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Sparkle className="h-3 w-3 text-primary" />
                  <span>{qp}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.role === "user"
                ? "ml-6 bg-primary/10 text-foreground"
                : "mr-2 border border-border bg-muted/30 text-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap">{msg.text}</p>
            {msg.role === "assistant" && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => void handleConvertExtract(msg)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                >
                  <Quotes className="h-3 w-3 text-primary" />
                  <span>
                    {convertedIds[msg.id] === "extract"
                      ? "Saved to Extract"
                      : "Convert Explanation to Extract"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleConvertFlashcard(msg)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                >
                  <Cards className="h-3 w-3 text-primary" />
                  <span>
                    {convertedIds[msg.id] === "flashcard"
                      ? "Saved Flashcard"
                      : "Convert to Flashcard"}
                  </span>
                </button>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div data-pending-reply className="flex flex-col gap-2">
            <div className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
              <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{t(CHAT_STATUS_KEYS[pendingStage ?? "preparing"])}</span>
              <button type="button" onClick={stopReply} aria-label={t("common.stop")} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <Square className="h-3 w-3" weight="fill" aria-hidden="true" />{t("common.stop")}
              </button>
            </div>
          </div>
        )}

        {aiFailure && (
          <GracefulAiFallbackCard
            errorKind={aiFailure.kind}
            errorMessage={aiFailure.message}
            preservedQuote={selectedText}
            preservedPrompt={aiFailure.prompt}
            onFallbackManual={() => {
              void onConvertToExtract({
                content: selectedText,
                notes: aiFailure.prompt,
              });
              setAiFailure(null);
            }}
            onRetrySmallerContext={(scale) => {
              void submitPrompt(aiFailure.prompt, scale);
            }}
          />
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask about this selection..."
            aria-label="Ask Socratic question"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={isLoading || !prompt.trim()}
            aria-label="Send question"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <PaperPlaneRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}

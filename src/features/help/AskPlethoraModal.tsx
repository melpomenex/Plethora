/**
 * AskPlethoraModal
 * Dedicated conversational Q&A modal powered by Ask Plethora RAG and canonical product docs.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  AskPlethoraResult,
  askPlethora,
} from "../../lib/ai/tasks/definitions/askPlethoraTask";
import type { HelpAppContext, HelpCitationRef } from "./helpTypes";
import { HelpDocViewer } from "./HelpDocViewer";
import { HelpCitationPill } from "./HelpCitationPill";
import { DirectAnswerCard } from "./DirectAnswerCard";
import {
  ArrowRight,
  BookOpen,
  ChatCircleDots,
  CircleNotch,
  Lightning,
  PaperPlaneRight,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { defaultHelpRetrieval } from "./helpRetrieval";
import { dispatchRegisteredHelpAction } from "./registeredHelpActions";
import { renderMarkdown } from "../../utils/markdown";

export interface AskPlethoraModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  context?: Partial<HelpAppContext>;
}

interface MessageItem {
  id: string;
  sender: "user" | "plethora";
  text: string;
  result?: AskPlethoraResult;
  citations?: HelpCitationRef[];
  timestamp: Date;
}

const SAMPLE_QUESTIONS = [
  "How do I enable E-ink monochrome mode?",
  "What is the 3D SInc matrix in the Adaptive scheduler?",
  "How do composition sliders work in the queue?",
  "Why is my queue item reappearing tomorrow?",
  "How do I mine sentences while reading?",
  "How does TTS word highlighting work?",
];

export const AskPlethoraModal: React.FC<AskPlethoraModalProps> = ({
  isOpen,
  onClose,
  initialQuery = "",
  context = {},
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (initialQuery && messages.length === 0) {
        handleSend(initialQuery);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const q = (textToSend ?? query).trim();
    if (!q || isLoading) return;

    const userMsg: MessageItem = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: q,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setIsLoading(true);

    try {
      const res = await askPlethora({
        query: q,
        context,
      });

      // Map citations to HelpCitationRef objects
      const citations: HelpCitationRef[] = (res.answer.sourceRefs || []).map((ref, idx) => {
        const chunk = res.usedChunks.find((c) => c.id === ref.refId || c.id.replace(/[^a-zA-Z0-9_-]/g, "-") === ref.refId);
        const doc = chunk ? defaultHelpRetrieval.getDocument(chunk.docId) : undefined;
        return {
          index: idx + 1,
          docId: chunk?.docId || ref.refId.split("#")[0],
          refId: ref.refId,
          title: chunk?.title || doc?.title || "Documentation",
          section: chunk?.section || "Overview",
          snippet: ref.quote,
          quote: ref.quote,
        };
      });

      const plethoraMsg: MessageItem = {
        id: `plethora-${Date.now()}`,
        sender: "plethora",
        text: res.answer.answer,
        result: res,
        citations,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, plethoraMsg]);
    } catch (err) {
      const errorMsg: MessageItem = {
        id: `err-${Date.now()}`,
        sender: "plethora",
        text: "I encountered an error answering your question. Please check that product documentation is indexed.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-glass-fade-in">
        <div
          className="relative w-full max-w-3xl h-[80vh] flex flex-col rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-glass-scale-in"
          role="dialog"
          aria-modal="true"
          aria-label="Ask Plethora Product Assistant"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-tr from-primary-600 to-amber-500 text-white shadow-sm">
                <Sparkle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
                  <span>Ask Plethora</span>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300">
                    Product Guide & RAG
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  Grounded in 75 canonical product documents • 0% hallucination
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close Ask Plethora modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8 space-y-6">
                <div className="p-4 rounded-2xl bg-primary-500/10 text-primary-400">
                  <ChatCircleDots className="w-10 h-10" />
                </div>
                <div className="max-w-md space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    What would you like to know about Plethora?
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Ask about keyboard shortcuts, spaced repetition formulas, TTS engines, or troubleshooting tips.
                  </p>
                </div>

                {/* Sample Prompt Chips */}
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {SAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSend(q)}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted/60 hover:bg-muted text-foreground/90 border border-border/60 transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.sender === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-primary-600 text-white rounded-br-none"
                        : "bg-muted/50 border border-border/60 text-foreground rounded-bl-none shadow-sm"
                    }`}
                  >
                    {msg.sender === "user" ? (
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    ) : (
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_pre]:my-2 [&_code]:text-[11px] [&_strong]:font-semibold [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs text-foreground/90"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                      />
                    )}

                    {/* Citations Footer */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground/80">Citations:</span>
                        {msg.citations.map((cite) => (
                          <HelpCitationPill
                            key={cite.index}
                            citation={cite}
                            onClick={(docId) => setSelectedDocId(docId)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <CircleNotch className="w-4 h-4 animate-spin text-primary-400" />
                <span>Searching canonical product documentation...</span>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          {/* Input Footer */}
          <div className="p-4 border-t border-border/60 bg-muted/20">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background border border-border focus-within:border-primary-400 transition-all shadow-inner">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about any feature, setting, shortcut, or algorithm..."
                className="flex-1 bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!query.trim() || isLoading}
                className="p-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white transition-colors"
                aria-label="Send question"
              >
                <PaperPlaneRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded HelpDocViewer */}
      {selectedDocId && (
        <HelpDocViewer
          initialDocId={selectedDocId}
          isOpen={!!selectedDocId}
          onClose={() => setSelectedDocId(null)}
        />
      )}
    </>
  );
};

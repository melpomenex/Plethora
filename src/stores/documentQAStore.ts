import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SectionSourceReference } from "../utils/sectionIndex";

/**
 * One retrieval citation attached to an assistant answer. Legacy shape kept
 * from the retired `rag_chat` command; semantic-index retrieval results
 * (`src/api/ai-learning.ts`) are mapped into it by the Q&A surfaces so the
 * persisted session history and the interactive sources footer keep working.
 */
export interface RagHit {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
}

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "success" | "error";
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  sourceDocuments?: string[];
  /**
   * Structured retrieval citations for assistant answers produced from library
   * RAG. Optional so sessions persisted before this field existed keep
   * rendering exactly as saved (their sources are baked into `content` as
   * markdown text and must not gain a duplicated footer).
   */
  citations?: RagHit[];
  toolCalls?: ToolCall[];
  mentionedDocumentIds?: string[];
  sourceContext?: SectionSourceReference;
}

interface DocumentQAState {
  // Conversation state
  messages: Message[];
  isProcessing: boolean;

  // Actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
  setIsProcessing: (isProcessing: boolean) => void;
  updateToolCall: (messageId: string, callIndex: number, updates: Partial<ToolCall>) => void;
}

export const useDocumentQAStore = create<DocumentQAState>()(
  persist(
    (set) => ({
      // Initial state
      messages: [],
      isProcessing: false,

      // Actions
      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message],
        })),

      updateMessage: (id, updates) =>
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, ...updates } : msg
          ),
        })),

      setMessages: (messages) => set({ messages }),

      clearMessages: () => set({ messages: [] }),

      setIsProcessing: (isProcessing) => set({ isProcessing }),

      updateToolCall: (messageId, callIndex, updates) =>
        set((state) => ({
          messages: state.messages.map((message) => {
            if (message.id !== messageId || !message.toolCalls) return message;
            const updatedCalls = message.toolCalls.map((call, index) =>
              index === callIndex ? { ...call, ...updates } : call
            );
            return { ...message, toolCalls: updatedCalls };
          }),
        })),
    }),
    {
      name: "incrementum-document-qa",
      // The Document Q&A sessions store (src/components/tabs/documentQaSessions.ts)
      // is now the authoritative persistence layer: it owns the per-session
      // messages and migrates this legacy key on first load. Persist nothing
      // new here so the two layers cannot diverge; the legacy key is retained
      // read-only for one release as a migration/rollback source.
      partialize: () => ({}),
    }
  )
);

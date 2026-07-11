import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SectionSourceReference } from "../utils/sectionIndex";

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
      partialize: (state) => ({ messages: state.messages }),
    }
  )
);

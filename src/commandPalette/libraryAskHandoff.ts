/** Typed, acknowledged palette → Document Q&A entry. Never submits a turn. */
import { create } from "zustand";

export interface LibraryAskHandoff {
  nonce: number;
  intent: "open" | "prefill";
  question: string;
  contextPassage?: string;
  documentId?: string;
}

type QuestionHandoff = Omit<LibraryAskHandoff, "nonce" | "intent">;

interface LibraryAskHandoffState {
  pending: LibraryAskHandoff | null;
  requestOpen: () => void;
  requestAsk: (handoff: QuestionHandoff) => void;
  /** With an id, acknowledges only that request; without one, dismisses. */
  consumeAsk: (nonce?: number) => void;
}

let nonceCounter = 0;
export const useLibraryAskHandoffStore = create<LibraryAskHandoffState>((set) => ({
  pending: null,
  requestOpen: () => set((state) => state.pending?.intent === "open" ? state : {
    pending: { nonce: ++nonceCounter, intent: "open", question: "" },
  }),
  requestAsk: (handoff) => set({
    pending: { ...handoff, nonce: ++nonceCounter, intent: "prefill" },
  }),
  consumeAsk: (nonce) => set((state) =>
    nonce === undefined || state.pending?.nonce === nonce ? { pending: null } : state),
}));

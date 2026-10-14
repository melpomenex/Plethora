/**
 * Typed handoff for "ask my library" prompts.
 *
 * Selecting a library suggestion must prefill the grounded library-assistant
 * composer with the complete prompt (and optional document context) without
 * starting a model request. The palette writes one pending handoff here and
 * closes; a host mounted in the app shell consumes it exactly once. This
 * replaces the old timing-dependent bare `ask-library` window event.
 */

import { create } from "zustand";

export interface LibraryAskHandoff {
  /** Monotonic id so the host can tell two identical handoffs apart. */
  nonce: number;
  question: string;
  /** Optional saved passage giving the question document context. */
  contextPassage?: string;
  /** Document the question is about, when one is known. */
  documentId?: string;
}

interface LibraryAskHandoffState {
  pending: LibraryAskHandoff | null;
  requestAsk: (handoff: Omit<LibraryAskHandoff, "nonce">) => void;
  /** Called by the host after it has opened the composer once. */
  consumeAsk: () => void;
}

let nonceCounter = 0;

export const useLibraryAskHandoffStore = create<LibraryAskHandoffState>((set) => ({
  pending: null,
  requestAsk: (handoff) =>
    set({
      pending: {
        ...handoff,
        nonce: ++nonceCounter,
      },
    }),
  consumeAsk: () => set({ pending: null }),
}));

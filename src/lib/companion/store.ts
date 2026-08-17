/**
 * Companion runtime store. Holds current visual state + active speech.
 * Domain code calls `notifyCompanion(event, ctx)`; the host component reacts.
 */

import { create } from "zustand";
import { ambientReaction, createCompanionEngine } from "./engine";
import type {
  CompanionContext,
  CompanionEvent,
  CompanionMode,
  CompanionPosition,
  CompanionReaction,
  CompanionStateId,
} from "./types";

export interface ActiveSpeech {
  key: string;
  vars?: Record<string, string | number>;
  /** Auto-dismiss timestamp (policy-owned; host clears on Escape). */
  expiresAt: number;
}

interface CompanionStore {
  state: CompanionStateId;
  /** Where the bird currently rests (host keeps this in sync imperatively). */
  position: CompanionPosition | null;
  mode: CompanionMode;
  setMode: (mode: CompanionMode) => void;
  setPosition: (position: CompanionPosition) => void;
  /** Non-null while a transient state plays; host resets to perch after. */
  transientUntil: number | null;
  speech: ActiveSpeech | null;
  sessionSpeechCount: number;
  recentSpeechKeys: string[];
  lastSpeechAt: number;
  /** Last time any event arrived (drives ambient sleep). */
  lastActivityAt: number;
  notify: (event: CompanionEvent, ctx: CompanionContext) => void;
  ambient: (seedUnit: number, ctx: CompanionContext) => void;
  setState: (state: CompanionStateId, transientUntil?: number | null) => void;
  clearSpeech: () => void;
  /** Records a bubble that was actually displayed (budget + no-repeat input). */
  consumeSpeech: (key: string, now: number) => void;
}

const engine = createCompanionEngine();

function reactionPatch(reaction: CompanionReaction, now: number): Partial<CompanionStore> {
  const patch: Partial<CompanionStore> = {
    state: reaction.state,
    transientUntil: reaction.durationMs ? now + reaction.durationMs : null,
  };
  if (reaction.speechKey) {
    patch.speech = {
      key: reaction.speechKey,
      vars: reaction.speechVars,
      expiresAt: now + 6000,
    };
  }
  return patch;
}

export const useCompanionStore = create<CompanionStore>((set) => ({
  state: "perch",
  position: null,
  mode: "anchored",
  setMode: (mode) => set({ mode }),
  setPosition: (position) => set({ position }),
  transientUntil: null,
  speech: null,
  sessionSpeechCount: 0,
  recentSpeechKeys: [],
  lastSpeechAt: 0,
  lastActivityAt: Date.now(),
  notify: (event, ctx) => {
    const reaction = engine.react(event, ctx);
    set({ lastActivityAt: ctx.now });
    if (!reaction) return;
    set(reactionPatch(reaction, ctx.now));
  },
  ambient: (seedUnit, ctx) => {
    const reaction = ambientReaction(seedUnit, ctx);
    set(reactionPatch(reaction, ctx.now));
  },
  setState: (state, transientUntil = null) => set({ state, transientUntil }),
  clearSpeech: () => set({ speech: null }),
  consumeSpeech: (key, now) =>
    set((s) => ({
      sessionSpeechCount: s.sessionSpeechCount + 1,
      recentSpeechKeys: [...s.recentSpeechKeys.slice(-7), key],
      lastSpeechAt: now,
    })),
}));

/** Imperative bridge for domain call sites (non-React contexts). */
export function notifyCompanion(event: CompanionEvent, ctx: CompanionContext) {
  useCompanionStore.getState().notify(event, ctx);
}

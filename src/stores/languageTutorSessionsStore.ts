/**
 * Tutor session history (change: add-learner-aware-ai-language-tutor, 2.1).
 *
 * Minimal local record of completed tutor responses: mode, prompt/response
 * excerpts, attribution, privacy path, and timestamp. Persisted to
 * localStorage (`plethora-language-tutor-sessions`), bounded at
 * TUTOR_SESSION_HISTORY_LIMIT entries (oldest first eviction). Recording a
 * session has NO learning-item or queue side effects. Export is a plain
 * JSON string of the current entries; delete/clear operate on the local
 * history only and never touch provider rows.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TutorAttribution, TutorMode } from "../lib/languageTutor";

export const TUTOR_SESSION_HISTORY_LIMIT = 50;
export const TUTOR_SESSION_EXCERPT_LIMIT = 400;
export const TUTOR_SESSION_PROMPT_LIMIT = 120;

export interface TutorSessionEntry {
  id: string;
  profileId: string;
  mode: TutorMode;
  promptExcerpt: string;
  responseExcerpt: string;
  attribution: TutorAttribution;
  privacyPath: string;
  createdAt: number;
}

export interface TutorSessionState {
  entries: TutorSessionEntry[];
  addSession: (input: Omit<TutorSessionEntry, "id" | "createdAt">) => void;
  deleteSession: (id: string) => void;
  clearSessions: () => void;
  exportSessions: () => string;
}

function excerpt(text: string, limit: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export const useTutorSessionsStore = create<TutorSessionState>()(
  persist(
    (set, get) => ({
      entries: [],
      addSession: (input) => {
        if (!input.profileId || !input.responseExcerpt.trim()) return;
        const entry: TutorSessionEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          profileId: input.profileId,
          mode: input.mode,
          promptExcerpt: excerpt(input.promptExcerpt, TUTOR_SESSION_PROMPT_LIMIT),
          responseExcerpt: excerpt(input.responseExcerpt, TUTOR_SESSION_EXCERPT_LIMIT),
          attribution: input.attribution,
          privacyPath: input.privacyPath,
          createdAt: Date.now(),
        };
        const entries = [entry, ...get().entries];
        set({
          entries:
            entries.length > TUTOR_SESSION_HISTORY_LIMIT
              ? entries.slice(0, TUTOR_SESSION_HISTORY_LIMIT)
              : entries,
        });
      },
      deleteSession: (id) => {
        set({ entries: get().entries.filter((entry) => entry.id !== id) });
      },
      clearSessions: () => {
        set({ entries: [] });
      },
      exportSessions: () => JSON.stringify(get().entries, null, 2),
    }),
    {
      name: "plethora-language-tutor-sessions",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

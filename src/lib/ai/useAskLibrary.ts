/**
 * React state machine for the "Ask library" surfaces (task 4.10): runs
 * `askLibrary` with cancellation and surfaces the structured result
 * (validated answer, cited sources, retrieval mode) plus the privacy
 * indicator inputs (on-device vs cloud path).
 *
 * One hook, two surfaces: the search page's Ask-library mode and the
 * selection sheet's ask-library action share it so behavior (config
 * resolution, abort-on-unmount, error mapping) cannot drift.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  askLibrary,
  type AskLibraryResult,
} from "./tasks/definitions/libraryTask";
import { resolveEmbeddingConfigForRag } from "../../components/assistant/ragConfig";
import { toAIError } from "./errors";

export interface UseAskLibrary {
  running: boolean;
  /** Human-readable failure (typed AIError message when available). */
  error: string | null;
  result: AskLibraryResult | null;
  /** Ask a question; aborts any in-flight ask. */
  ask: (query: string, options?: { contextPassage?: string }) => Promise<void>;
  reset: () => void;
}

export function useAskLibrary(): UseAskLibrary {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskLibraryResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort whatever is in flight when the surface unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (query: string, options: { contextPassage?: string } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setResult(null);
      try {
        // Embedding config resolution is best-effort: without a configured
        // cloud/Ollama provider the backend's on-device default applies and
        // retrieval degrades to lexical-only instead of failing.
        const config = await resolveEmbeddingConfigForRag().catch(() => undefined);
        const next = await askLibrary({
          query,
          config,
          contextPassage: options.contextPassage,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setResult(next);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(toAIError(e).message || String(e));
      } finally {
        if (!controller.signal.aborted) setRunning(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setError(null);
    setResult(null);
  }, []);

  return { running, error, result, ask, reset };
}

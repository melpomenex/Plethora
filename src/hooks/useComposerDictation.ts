import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createFeedbackInteractionId } from "../lib/feedback/orchestrator";
import { createDictationAdapter, dictationCoordinator } from "../lib/speech/dictation";
import { DICTATION_LIMITS, type DictationCapability } from "../lib/speech/contracts";
export function insertDictation(text: string, selectionStart: number, selectionEnd: number, transcript: string) {
  return text.slice(0, selectionStart) + transcript + text.slice(selectionEnd);
}
export function useComposerDictation(options: { active: boolean; resetKey: unknown; text: string; setText: (text: string) => void; inputRef: RefObject<HTMLTextAreaElement | null>; requireOnDevice: boolean }) {
  const latest = useRef(options); latest.current = options;
  const adapter = useRef<ReturnType<typeof createDictationAdapter> | null>(null);
  const generation = useRef(0);
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [capability, setCapability] = useState<DictationCapability | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const saved = useRef({ text: "", start: 0, end: 0 });
  const cancel = useCallback(() => {
    generation.current++; clearTimeout(timer.current); setNeedsConsent(false); setPhase("idle");
    const id = session.current; session.current = null;
    if (id) void dictationCoordinator.cancel(id);
  }, []);
  const stop = useCallback(async () => {
    const id = session.current;
    if (!id) return;
    const epoch = generation.current;
    clearTimeout(timer.current); setPhase("stopping");
    try {
      const result = await dictationCoordinator.stop(id);
      if (generation.current !== epoch || session.current !== id || !latest.current.active || latest.current.text !== saved.current.text) return;
      session.current = null; generation.current++;
      latest.current.setText(insertDictation(saved.current.text, saved.current.start, saved.current.end, result.text));
    } catch (error) {
      if (generation.current === epoch) setError(`${String(error)}. Type or use your keyboard's dictation, or try again.`);
    } finally { if (generation.current === epoch || session.current === null) { session.current = null; setPhase("idle"); } }
  }, []);
  const start = useCallback(async (networkConsent = false) => {
    if (!latest.current.active || session.current) return;
    const transport = adapter.current ??= createDictationAdapter();
    const epoch = ++generation.current;
    setError(null);
    try {
      const cap = capability ?? await transport.status(navigator.language || "en-US");
      if (generation.current !== epoch || !latest.current.active) return;
      if (!cap.available || (latest.current.requireOnDevice && cap.processing !== "on-device")) { setError("App dictation is unavailable here. Type or use your keyboard's dictation."); return; }
      if (cap.processing !== "on-device" && !networkConsent) { setNeedsConsent(true); return; }
      setNeedsConsent(false);
      const field = latest.current.inputRef.current;
      saved.current = { text: latest.current.text, start: field?.selectionStart ?? latest.current.text.length, end: field?.selectionEnd ?? latest.current.text.length };
      const id = createFeedbackInteractionId(); session.current = id; setPhase("starting");
      await dictationCoordinator.start(transport, { sessionId: id, locale: cap.locale, requireOnDevice: latest.current.requireOnDevice, networkConsent }, cap);
      if (generation.current !== epoch || session.current !== id || !latest.current.active) { void dictationCoordinator.cancel(id); return; }
      setPhase("listening"); timer.current = setTimeout(() => { void stop(); }, DICTATION_LIMITS.captureMs);
    } catch (error) {
      if (generation.current === epoch) { session.current = null; setPhase("idle"); setError(`${String(error)}. Type or use keyboard dictation, or try again.`); }
    }
  }, [capability, stop]);
  useEffect(() => {
    let alive = true;
    if (options.active) {
      const transport = adapter.current ??= createDictationAdapter();
      void transport.status(navigator.language || "en-US").then(cap => { if (alive) setCapability(cap); }, () => { if (alive) setError("App dictation unavailable. Type or use keyboard dictation."); });
    } else cancel();
    return () => { alive = false; cancel(); };
  }, [options.active, options.resetKey, cancel]);
  useEffect(() => { if (session.current && options.requireOnDevice && capability?.processing !== "on-device") cancel(); }, [options.requireOnDevice, capability, cancel]);
  useEffect(() => { if (session.current && options.text !== saved.current.text) cancel(); }, [options.text, cancel]);
  useEffect(() => {
    const background = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", cancel);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", cancel); };
  }, [cancel]);
  return { phase, capability, error, needsConsent, start, stop, cancel, onEdit: cancel,
    disabled: !capability?.available || (options.requireOnDevice && capability.processing !== "on-device") };
}
export type ComposerDictation = ReturnType<typeof useComposerDictation>;

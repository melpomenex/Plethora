import { useEffect, useMemo, useState } from "react";
import { Check, Microphone, Play, Trash, X } from "@phosphor-icons/react";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, dispatchLanguageHostAction, type LanguageHostActionDetail } from "../../lib/languageHost";
import { acceptPracticeEvidence, createPracticeAttempt, isPracticeAttemptCurrent, submitPracticeAttempt } from "../../lib/languagePractice";
import type { PracticeAttempt, PracticeMode } from "../../lib/languagePractice";
import { createShadowingSession } from "../../lib/languageShadowing";
import { canProvidePronunciation } from "../../lib/languagePronunciation";
import type { PracticeSource } from "../../lib/languagePractice";
import { deleteLanguagePracticeAttempt, upsertLanguagePracticeAttempt } from "../../api/languagePractice";
import { isTauri } from "../../lib/tauri";

const STORAGE_PREFIX = "plethora.language-practice.session.";

function toPracticeSource(request: LanguageHostActionDetail): PracticeSource {
  return {
    sourceType: request.source.source.sourceType,
    sourceId: request.source.contentId,
    sourceAnchor: request.sourceAnchor,
    sourceFingerprint: request.source.contentFingerprint,
    mediaId: request.source.source.mediaId,
  };
}

function newAttempt(request: LanguageHostActionDetail, mode: PracticeMode): PracticeAttempt {
  return createPracticeAttempt({
    id: `${request.hostId}:practice:${Date.now()}`,
    profileId: request.profileId ?? "",
    mode,
    source: toPracticeSource(request),
    promptText: request.selectedText ?? request.source.text ?? "",
  });
}

/** Shared, source-preserving practice shell. It never calls review rating or creates a card. */
export function LanguagePracticeOverlay() {
  const { snapshot } = useLanguageLearningHost();
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [mode, setMode] = useState<PracticeMode>("dictation");
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [micStatus, setMicStatus] = useState<"unavailable" | "requesting" | "ready" | "denied">("unavailable");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (!detail || detail.hostId !== snapshot.hostId || detail.action !== "practice") return;
      setRequest(detail);
      setMode("dictation");
      setAttempt(newAttempt(detail, "dictation"));
      setAnswer("");
      setRevealed(false);
      setError(null);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  const prompt = request?.selectedText?.trim() || request?.source.text?.trim() || "";
  const storageKey = request ? `${STORAGE_PREFIX}${snapshot.profile?.id ?? "unknown"}:${request.source.contentId}` : null;
  const saved = useMemo(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try { return JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as PracticeAttempt | null; } catch { return null; }
  }, [storageKey]);

  useEffect(() => {
    if (saved && request && isPracticeAttemptCurrent(saved, request.source.contentFingerprint) && saved.promptText === prompt) {
      setAttempt(saved);
      setMode(saved.mode);
    }
  }, [prompt, request, saved]);

  useEffect(() => {
    if (!request || mode === attempt?.mode) return;
    setAttempt(newAttempt(request, mode));
    setAnswer("");
    setRevealed(false);
    setError(null);
  }, [attempt?.mode, mode, request]);

  if (!request || !attempt || snapshot.status !== "ready") return null;

  const comparison = attempt.comparison;
  const isProductionMode = mode === "writing" || mode === "shadowing" || mode === "pronunciation";
  const replay = () => dispatchLanguageHostAction({
    action: "replay",
    hostId: snapshot.hostId,
    source: request.source,
    sourceAnchor: request.sourceAnchor,
    selectedText: prompt,
    profileId: snapshot.profile?.id,
    languageTag: snapshot.profile?.targetLanguage,
    origin: "practice",
  });

  const submit = () => {
    const raw = answer;
    if (!raw.trim()) return;
    const next = submitPracticeAttempt(attempt, raw);
    setAttempt(next);
    setRevealed(true);
  };

  const save = () => {
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(attempt));
    if (isTauri()) void upsertLanguagePracticeAttempt(attempt).catch(() => setError("The local practice copy was saved, but durable sync is unavailable."));
  };
  const remove = () => {
    if (storageKey) window.localStorage.removeItem(storageKey);
    if (isTauri()) void deleteLanguagePracticeAttempt(attempt.profileId, attempt.id).catch(() => undefined);
    setAttempt(newAttempt(request, mode));
    setAnswer("");
    setRevealed(false);
  };
  const acceptEvidence = () => setAttempt((current) => current ? acceptPracticeEvidence(current) : current);

  const startMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("unavailable");
      setError("Microphone capture is unavailable; use original-audio replay or text practice.");
      return;
    }
    setMicStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus("ready");
      setAttempt((current) => current ? { ...current, status: "recording", recordingPolicy: { ...current.recordingPolicy, allowMicrophone: true } } : current);
    } catch {
      setMicStatus("denied");
      setError("Microphone permission was not granted. No recording was saved.");
    }
  };

  const shadowing = createShadowingSession({ id: attempt.id, profileId: attempt.profileId, flow: "listen-first", source: attempt.source, promptText: prompt, recordingPolicy: attempt.recordingPolicy });
  const pronunciationAvailable = Boolean(snapshot.profile && canProvidePronunciation({ providerId: "none", providerVersion: "none", capabilities: [], languages: [], sendsAudioOffDevice: false, maxAudioMs: 0, configured: false }, "transcription", snapshot.profile.targetLanguage));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" data-language-practice-overlay="true">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="language-practice-title">
        <div className="flex items-center gap-2">
          <h2 id="language-practice-title" className="text-base font-semibold">Language practice</h2>
          <span className="text-xs text-muted-foreground">{snapshot.profile?.targetLanguage}</span>
          <button type="button" className="ml-auto rounded p-1 hover:bg-muted" aria-label="Exit practice" onClick={() => setRequest(null)}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Practice mode">
          {(["dictation", "shadowing", "writing", "pronunciation"] as PracticeMode[]).map((candidate) => (
            <button key={candidate} type="button" role="tab" aria-selected={mode === candidate} className={`rounded-md border px-2.5 py-1.5 text-xs ${mode === candidate ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`} onClick={() => setMode(candidate)}>{candidate[0]!.toUpperCase() + candidate.slice(1)}</button>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-center text-lg leading-relaxed" aria-live="polite">
          {mode === "dictation" && !revealed ? "Listen, then type what you heard." : prompt}
        </div>
        {mode === "shadowing" && <p className="mt-2 text-xs text-muted-foreground">Listen first is the default. Microphone capture is optional and local-only until explicitly enabled.</p>}
        {mode === "pronunciation" && <p className="mt-2 text-xs text-muted-foreground">{pronunciationAvailable ? "Pronunciation provider ready." : "Pronunciation scoring is unavailable; no score is fabricated."}</p>}
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={isProductionMode ? "Write or describe your response…" : "Type the transcript…"} className="mt-3 min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" aria-label="Practice response" />
        {comparison && <div className="mt-2 rounded-lg border border-border p-3 text-sm" data-practice-comparison="true"><p className={comparison.exact ? "text-success" : "text-foreground"}>{comparison.exact ? "Exact match" : `Comparison ${Math.round(comparison.score * 100)}%`}</p>{comparison.errors.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{comparison.errors.map((item) => item.kind).join(" · ")}</p>}</div>}
        {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={replay}><Play className="h-3.5 w-3.5" /> Replay</button>
          {mode === "shadowing" && <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={startMicrophone} disabled={micStatus === "requesting"}><Microphone className="h-3.5 w-3.5" /> {micStatus === "ready" ? "Mic ready" : "Enable mic"}</button>}
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={submit} disabled={!answer.trim()}>Check</button>
          {mode === "dictation" && <button type="button" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => setRevealed(true)}>Reveal</button>}
          <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={save}><Check className="h-3.5 w-3.5" /> Save</button>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-destructive hover:bg-muted" onClick={remove}><Trash className="h-3.5 w-3.5" /> Delete</button>
        </div>
        {comparison && !attempt.activeEvidenceAccepted && <button type="button" className="mt-3 w-full rounded-md border border-primary/40 px-3 py-2 text-xs text-primary hover:bg-primary/10" onClick={acceptEvidence}>Accept as active evidence (does not rate or schedule)</button>}
        {attempt.activeEvidenceAccepted && <p className="mt-3 text-center text-xs text-success">Active evidence accepted; review scheduling remains separate.</p>}
        <p className="mt-3 text-[11px] text-muted-foreground">Source position is preserved from {shadowing.source.sourceType ?? "this surface"}. Raw responses remain local and are deleted with this session.</p>
      </div>
    </div>
  );
}

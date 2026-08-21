import { useEffect, useMemo, useRef, useState } from "react";
import { Check, DownloadSimple, Microphone, Play, Stop, Trash, X } from "@phosphor-icons/react";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, dispatchLanguageHostAction, type LanguageHostActionDetail } from "../../lib/languageHost";
import { acceptPracticeEvidence, createPracticeAttempt, recommendationPreview, resumePracticeAttempt, revealPracticeAttempt, shouldConfirmPracticeDiscard, submitPracticeAttempt } from "../../lib/languagePractice";
import { LANGUAGE_PRACTICE_RECOMMENDATION_EVENT, type LanguagePracticeRecommendationDetail } from "../../lib/languagePractice";
import type { PracticeAttempt, PracticeMode } from "../../lib/languagePractice";
import { canStartCapture, createShadowingSession } from "../../lib/languageShadowing";
import { advertisedPronunciationDimensions, canProvidePronunciation } from "../../lib/languagePronunciation";
import type { ShadowingFlow } from "../../lib/languageShadowing";
import type { PracticeSource } from "../../lib/languagePractice";
import { buildLearnerContext, type ContextLexiconRow } from "../../lib/languageTutor";
import { WritingPracticeService, type WritingPromptMode, type WritingResult } from "../../lib/languageWriting";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import { deleteLanguagePracticeAttempt, exportLanguagePracticeAttempts, purgeExpiredLanguagePracticeAttempts, upsertLanguagePracticeAttempt } from "../../api/languagePractice";
import { isTauri } from "../../lib/tauri";
import { createLanguageLearningDraft } from "../../lib/languageSrs";

const STORAGE_PREFIX = "plethora.language-practice.session.";

function toPracticeSource(request: LanguageHostActionDetail): PracticeSource {
  const locator = request.sourceAnchor?.locator;
  const locatorRecord = locator && typeof locator === "object" ? locator as Record<string, unknown> : null;
  const mediaId = typeof locatorRecord?.mediaId === "string" ? locatorRecord.mediaId : request.source.source.mediaId;
  const startMs = typeof locatorRecord?.startMs === "number" ? locatorRecord.startMs : undefined;
  const endMs = typeof locatorRecord?.endMs === "number" ? locatorRecord.endMs : undefined;
  return {
    sourceType: request.source.source.sourceType,
    sourceId: request.source.contentId,
    sourceAnchor: request.sourceAnchor,
    sourceFingerprint: request.source.contentFingerprint,
    mediaId,
    startMs,
    endMs,
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
  const [shadowingFlow, setShadowingFlow] = useState<ShadowingFlow>("listen-first");
  const [writingPromptMode, setWritingPromptMode] = useState<WritingPromptMode>("current-document");
  const [writingLexicon, setWritingLexicon] = useState<ContextLexiconRow[]>([]);
  const [acceptedWritingCorrections, setAcceptedWritingCorrections] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [micStatus, setMicStatus] = useState<"unavailable" | "requesting" | "ready" | "denied">("unavailable");
  const [captureActive, setCaptureActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writingResult, setWritingResult] = useState<WritingResult | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [recommendation, setRecommendation] = useState<ReturnType<typeof recommendationPreview> | null>(null);
  const [recommendationDetail, setRecommendationDetail] = useState<LanguagePracticeRecommendationDetail | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (!detail || detail.hostId !== snapshot.hostId || detail.action !== "practice") return;
      setRequest(detail);
      setMode(detail.practiceMode ?? "dictation");
      setShadowingFlow("listen-first");
      setWritingPromptMode("current-document");
      setAcceptedWritingCorrections(new Set());
      setAttempt(newAttempt(detail, detail.practiceMode ?? "dictation"));
      setAnswer("");
      setRevealed(false);
      setError(null);
      setWritingResult(null);
      setRecommendation(null);
      setRecommendationDetail(null);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  useEffect(() => {
    const onRecommendation = (event: Event) => {
      const detail = (event as CustomEvent<LanguagePracticeRecommendationDetail>).detail;
      if (!detail || detail.hostId !== snapshot.hostId || detail.profileId !== snapshot.profile?.id) return;
      setRecommendation(recommendationPreview(detail.candidate));
      setRecommendationDetail(detail);
      setRequest(null);
      setAttempt(null);
      setError(null);
    };
    window.addEventListener(LANGUAGE_PRACTICE_RECOMMENDATION_EVENT, onRecommendation);
    return () => window.removeEventListener(LANGUAGE_PRACTICE_RECOMMENDATION_EVENT, onRecommendation);
  }, [snapshot.hostId, snapshot.profile?.id]);

  const prompt = request?.selectedText?.trim() || request?.source.text?.trim() || "";
  const storageKey = request ? `${STORAGE_PREFIX}${snapshot.profile?.id ?? "unknown"}:${request.source.contentId}` : null;
  const saved = useMemo(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try { return JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as PracticeAttempt | null; } catch { return null; }
  }, [storageKey]);

  useEffect(() => {
    const resumed = resumePracticeAttempt(saved, { sourceFingerprint: request?.source.contentFingerprint, promptText: prompt });
    if (resumed && request) {
      setAttempt(resumed);
      setMode(resumed.mode);
    }
  }, [prompt, request, saved]);

  useEffect(() => {
    if (!request || mode === attempt?.mode) return;
    setAttempt(newAttempt(request, mode));
    setAnswer("");
    setRevealed(false);
    setError(null);
    setWritingResult(null);
    setShadowingFlow("listen-first");
    setWritingPromptMode("current-document");
    setAcceptedWritingCorrections(new Set());
  }, [attempt?.mode, mode, request]);

  useEffect(() => {
    let disposed = false;
    if (mode !== "writing" || snapshot.status !== "ready" || !snapshot.profile) {
      setWritingLexicon([]);
      return () => { disposed = true; };
    }
    void listLanguageLexicalEntries(snapshot.profile.id, { languageTag: snapshot.profile.targetLanguage, offset: 0, limit: 24 })
      .then((page) => {
        if (disposed) return;
        setWritingLexicon(page.items.flatMap((entry) => {
          const state = entry.knowledgeState;
          if (state !== "new" && state !== "encountered" && state !== "learning" && state !== "familiar" && state !== "known" && state !== "ignored") return [];
          return [{ entryId: entry.id, surface: entry.canonicalForm || entry.normalizedForm, lemma: entry.lemma, state, evidenceCount: entry.activeEvidenceCount + entry.passiveEvidenceCount }];
        }));
      })
      .catch(() => { if (!disposed) setWritingLexicon([]); });
    return () => { disposed = true; };
  }, [mode, snapshot.profile, snapshot.status]);

  useEffect(() => {
    if (!snapshot.profile || !isTauri()) return;
    void purgeExpiredLanguagePracticeAttempts(snapshot.profile.id).catch(() => undefined);
  }, [snapshot.profile]);

  if (snapshot.status !== "ready" || (!request && !recommendation)) return null;

  if (!request && recommendation && recommendationDetail) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="language-recommendation-title">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="language-recommendation-title" className="text-base font-semibold">Recommended practice</h2>
              <p className="mt-1 text-sm text-foreground">{recommendation.title}</p>
              <p className="mt-2 text-xs text-muted-foreground">{recommendation.explanation.join(" · ")}</p>
            </div>
            <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Close recommendation" onClick={() => { setRecommendation(null); setRecommendationDetail(null); }}><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => { setRecommendation(null); setRecommendationDetail(null); }}>Not now</button>
            <button type="button" className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => {
              const nextRequest: LanguageHostActionDetail = { action: "practice", hostId: recommendationDetail.hostId, source: recommendationDetail.source, sourceAnchor: recommendationDetail.sourceAnchor, selectedText: recommendationDetail.source.text, profileId: recommendationDetail.profileId, languageTag: recommendationDetail.languageTag, origin: recommendationDetail.origin };
              setRequest(nextRequest);
              setAttempt(newAttempt(nextRequest, "dictation"));
              setMode("dictation");
              setRecommendation(null);
              setRecommendationDetail(null);
            }}>Start practice</button>
          </div>
        </div>
      </div>
    );
  }

  if (!request || !attempt) return null;

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
    if (mode === "writing") {
      const now = Date.now();
      setAttempt((current) => current ? { ...current, rawResponse: raw, status: "submitted", updatedAt: now } : current);
      const profile = snapshot.profile;
      if (!profile) return;
      const context = buildLearnerContext({ profile: { id: profile.id, targetLanguage: profile.targetLanguage, baseLanguage: profile.baseLanguage }, lexicon: writingLexicon, currentSource: { documentId: request.source.contentId, text: prompt }, budget: { includeSourceText: false } });
      const vocabulary = writingLexicon.filter((item) => item.state !== "ignored").slice(0, 5).map((item) => item.surface).join(", ");
      const promptByMode: Record<WritingPromptMode, string> = {
        "current-document": `Write a response about this source: ${prompt}`,
        interest: `Write a short response about an interest related to this source: ${prompt}`,
        "target-vocabulary": `Write a response using these target words when natural: ${vocabulary || "the target vocabulary from this source"}. Source: ${prompt}`,
        "target-grammar": `Rewrite a response about this source using the target grammar pattern: ${prompt}`,
        translation: `Translate and then rewrite this source naturally in the target language: ${prompt}`,
        summary: `Write a concise target-language summary of this source: ${prompt}`,
        answer: `Answer this source-grounded question in the target language: ${prompt}`,
        rewrite: `Rewrite this source in a natural target-language register: ${prompt}`,
        dialogue: `Write the next short turn in a target-language dialogue based on this source: ${prompt}`,
      };
      const writingPrompt = { id: `${attempt.id}:writing`, profileId: attempt.profileId, mode: writingPromptMode, prompt: promptByMode[writingPromptMode], targetLanguage: profile.targetLanguage, source: attempt.source, context };
      void new WritingPracticeService().correct(writingPrompt, raw).then(setWritingResult).catch((reason) => setWritingResult({ draft: { id: writingPrompt.id, promptId: writingPrompt.id, profileId: attempt.profileId, rawText: raw, corrections: [], privacy: "local-only", createdAt: now, updatedAt: now }, status: "failed", error: reason instanceof Error ? reason.message : "writing-provider-failed" }));
      return;
    }
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
  const exportAttempts = async () => {
    if (!snapshot.profile || typeof document === "undefined") return;
    try {
      const attempts = isTauri()
        ? await exportLanguagePracticeAttempts(snapshot.profile.id)
        : (storageKey && window.localStorage.getItem(storageKey) ? [attempt] : []);
      const blob = new Blob([JSON.stringify(attempts, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `plethora-language-practice-${snapshot.profile.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Practice export is unavailable right now; the local attempt remains saved.");
    }
  };
  const acceptEvidence = () => {
    if (mode === "writing") {
      if (!attempt.rawResponse?.trim()) return;
      setAttempt((current) => current ? { ...current, activeEvidenceAccepted: true, updatedAt: Date.now() } : current);
      if (typeof window !== "undefined") {
        const draft = createLanguageLearningDraft({ itemType: "qa", question: prompt, answer: attempt.rawResponse, documentId: request.source.contentId, tags: ["language-practice", "writing"], interactionMetadata: { sourceAnchor: attempt.source.sourceAnchor, sourceFingerprint: attempt.source.sourceFingerprint, mode: "writing" }, provenance: { origin: "sentence", profileId: attempt.profileId, sourceAnchor: attempt.source.sourceAnchor, providerId: writingResult?.providerId, providerVersion: writingResult?.providerVersion, createdAt: Date.now() } });
        window.dispatchEvent(new CustomEvent("plethora-language-srs-draft", { detail: draft }));
      }
      return;
    }
    const accepted = acceptPracticeEvidence(attempt);
    setAttempt(accepted);
    if (accepted.activeEvidenceAccepted && typeof window !== "undefined") {
      const draft = createLanguageLearningDraft({
        itemType: "qa",
        question: accepted.promptText,
        answer: accepted.rawResponse || accepted.promptText,
        documentId: request.source.contentId,
        tags: ["language-practice"],
        interactionMetadata: { sourceAnchor: accepted.source.sourceAnchor, sourceFingerprint: accepted.source.sourceFingerprint, mode: accepted.mode },
        provenance: { origin: "sentence", profileId: accepted.profileId, sourceAnchor: accepted.source.sourceAnchor, createdAt: Date.now() },
      });
      window.dispatchEvent(new CustomEvent("plethora-language-srs-draft", { detail: draft }));
    }
  };

  const startMicrophone = async () => {
    if (shadowingFlow === "listen-first") replay();
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("unavailable");
      setError("Microphone capture is unavailable; use original-audio replay or text practice.");
      return;
    }
    setMicStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (typeof MediaRecorder !== "undefined") {
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.start();
        setCaptureActive(true);
      }
      if (!canStartCapture({ ...attempt.recordingPolicy, allowMicrophone: true }, true)) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setMicStatus("unavailable");
        setError("Microphone capture is unavailable for this practice policy; use listen-only or text comparison.");
        return;
      }
      setMicStatus("ready");
      setAttempt((current) => current ? { ...current, status: "recording", recordingPolicy: { ...current.recordingPolicy, allowMicrophone: true } } : current);
    } catch {
      setMicStatus("denied");
      setError("Microphone permission was not granted. No recording was saved.");
    }
  };

  const stopMicrophone = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCaptureActive(false);
    setAttempt((current) => current ? { ...current, status: "failed", updatedAt: Date.now() } : current);
    setError("Speech recognition is unavailable for this session. The capture was discarded; use text comparison or retry.");
  };

  const exit = () => {
    if (shouldConfirmPracticeDiscard(attempt)) {
      setDiscardRequested(true);
      return;
    }
    setRequest(null);
  };

  const shadowing = createShadowingSession({ id: attempt.id, profileId: attempt.profileId, flow: shadowingFlow, source: attempt.source, promptText: prompt, recordingPolicy: attempt.recordingPolicy });
  const pronunciationManifest = { providerId: "none", providerVersion: "none", capabilities: [], languages: [], sendsAudioOffDevice: false, maxAudioMs: 0, configured: false } as const;
  const pronunciationDimensions = snapshot.profile ? advertisedPronunciationDimensions(pronunciationManifest, snapshot.profile.targetLanguage) : [];
  const pronunciationAvailable = Boolean(snapshot.profile && canProvidePronunciation(pronunciationManifest, "transcription", snapshot.profile.targetLanguage));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" data-language-practice-overlay="true">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="language-practice-title">
        <div className="flex items-center gap-2">
          <h2 id="language-practice-title" className="text-base font-semibold">Language practice</h2>
          <span className="text-xs text-muted-foreground">{snapshot.profile?.targetLanguage}</span>
          <button type="button" className="ml-auto rounded p-1 hover:bg-muted" aria-label="Exit practice" onClick={exit}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Practice mode">
          {(["dictation", "shadowing", "writing", "pronunciation"] as PracticeMode[]).map((candidate) => (
            <button key={candidate} type="button" role="tab" aria-selected={mode === candidate} className={`rounded-md border px-2.5 py-1.5 text-xs ${mode === candidate ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`} onClick={() => setMode(candidate)}>{candidate[0]!.toUpperCase() + candidate.slice(1)}</button>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-center text-lg leading-relaxed" aria-live="polite">
          {mode === "dictation" && !revealed ? "Listen, then type what you heard." : prompt}
        </div>
        {mode === "shadowing" && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><label htmlFor="shadowing-flow">Flow</label><select id="shadowing-flow" value={shadowing.flow} onChange={(event) => setShadowingFlow(event.target.value as ShadowingFlow)} className="rounded border border-border bg-background px-2 py-1"><option value="listen-first">Listen first</option><option value="immediate">Immediate</option><option value="continuous">Continuous</option></select><span>{shadowing.flow === "listen-first" ? "Replay before capture." : shadowing.flow === "immediate" ? "Capture starts without replay." : "Keep capture active across attempts."}</span></div>}
        {mode === "pronunciation" && <p className="mt-2 text-xs text-muted-foreground">{pronunciationAvailable ? `Available: ${pronunciationDimensions.join(", ")}.` : "Pronunciation scoring is unavailable; no score is fabricated."}</p>}
        {mode === "writing" && <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">Prompt type<select aria-label="Writing prompt type" value={writingPromptMode} onChange={(event) => setWritingPromptMode(event.target.value as WritingPromptMode)} className="rounded border border-border bg-background px-2 py-1 text-foreground"><option value="current-document">Source response</option><option value="target-vocabulary">Target vocabulary</option><option value="interest">Interest</option><option value="summary">Summary</option><option value="answer">Answer</option><option value="rewrite">Rewrite</option><option value="dialogue">Dialogue</option><option value="target-grammar">Target grammar</option><option value="translation">Translation</option></select></label>}
        {mode === "writing" && writingResult && <div className="mt-2 rounded-lg border border-border p-3 text-sm" role="status"><p>{writingResult.status === "ready" ? "Correction ready." : writingResult.status === "unavailable" ? "No writing provider is configured; your draft remains recoverable." : "Correction unavailable; retry or self-assess."}</p>{writingResult.draft.corrections.map((correction) => <div key={correction.id} className="mt-2 border-t border-border pt-2"><p className="text-xs text-muted-foreground">{correction.category}</p><p>{correction.correctedText}</p><p className="text-xs text-muted-foreground">{correction.explanation}</p>{acceptedWritingCorrections.has(correction.id) ? <span className="text-[11px] text-success">Accepted for review</span> : <button type="button" className="mt-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted" onClick={() => { setAcceptedWritingCorrections((current) => new Set(current).add(correction.id)); setWritingResult((current) => current ? { ...current, draft: { ...current.draft, corrections: current.draft.corrections.map((item) => item.id === correction.id ? { ...item, accepted: true } : item) } } : current); }}>Accept correction</button>}</div>)}</div>}
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={isProductionMode ? "Write or describe your response…" : "Type the transcript…"} className="mt-3 min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" aria-label="Practice response" />
        {comparison && <div className="mt-2 rounded-lg border border-border p-3 text-sm" data-practice-comparison="true"><p className={comparison.exact ? "text-success" : "text-foreground"}>{comparison.exact ? "Exact match" : `Comparison ${Math.round(comparison.score * 100)}%`}</p>{comparison.errors.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{comparison.errors.map((item) => item.kind).join(" · ")}</p>}</div>}
        {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={replay}><Play className="h-3.5 w-3.5" /> Replay</button>
          {mode === "shadowing" && <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={captureActive ? stopMicrophone : startMicrophone} disabled={micStatus === "requesting"}><>{captureActive ? <Stop className="h-3.5 w-3.5" /> : <Microphone className="h-3.5 w-3.5" />}</> {captureActive ? "Stop capture" : micStatus === "ready" ? "Mic ready" : "Enable mic"}</button>}
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={submit} disabled={!answer.trim()}>Check</button>
          {mode === "dictation" && <button type="button" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => { setRevealed(true); setAttempt((current) => current ? revealPracticeAttempt(current) : current); }}>Reveal</button>}
          <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={save}><Check className="h-3.5 w-3.5" /> Save</button>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => void exportAttempts()}><DownloadSimple className="h-3.5 w-3.5" /> Export</button>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-destructive hover:bg-muted" onClick={remove}><Trash className="h-3.5 w-3.5" /> Delete</button>
        </div>
        {(comparison || (mode === "writing" && attempt.rawResponse?.trim())) && !attempt.activeEvidenceAccepted && <button type="button" className="mt-3 w-full rounded-md border border-primary/40 px-3 py-2 text-xs text-primary hover:bg-primary/10" onClick={acceptEvidence}>Accept as active evidence (does not rate or schedule)</button>}
        {attempt.activeEvidenceAccepted && <p className="mt-3 text-center text-xs text-success">Active evidence accepted; review scheduling remains separate.</p>}
        <p className="mt-3 text-[11px] text-muted-foreground">Source position is preserved from {shadowing.source.sourceType ?? "this surface"}. Raw responses remain local and are deleted with this session.</p>
        {discardRequested && <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs" role="alertdialog" aria-label="Discard practice attempt"><p>Discard this unsaved practice attempt?</p><div className="mt-2 flex justify-end gap-2"><button type="button" className="rounded border border-border px-2 py-1" onClick={() => setDiscardRequested(false)}>Keep editing</button><button type="button" className="rounded bg-destructive px-2 py-1 text-destructive-foreground" onClick={() => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setDiscardRequested(false); setRequest(null); }}>Discard</button></div></div>}
      </div>
    </div>
  );
}

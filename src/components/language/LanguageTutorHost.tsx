import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TutorSheet } from "../tutor/TutorSheet";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { dispatchLanguageHostAction, LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import {
  buildLearnerContext,
  createProductionLanguageTutorService,
  resolveTutorPrivacyPolicy,
  TUTOR_MODE_METADATA,
  type ContextLexiconRow,
  type TutorMode,
  type TutorResponse,
} from "../../lib/languageTutor";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { getActiveCloudConfig } from "../../lib/ai/providers/cloudProvider";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import { useTutorSessionsStore } from "../../stores/languageTutorSessionsStore";
import { useI18n } from "../../lib/i18n";

const LEXICON_PAGE_SIZE = 500;
const MAX_LEXICON_ENTRIES = 5000;

const VALID_STATES = new Set<LanguageKnowledgeState>([
  "new",
  "encountered",
  "learning",
  "familiar",
  "known",
  "ignored",
]);

async function loadPaginatedLearnerLexicon(
  profileId: string,
  languageTag: string,
  isDisposed: () => boolean,
): Promise<ContextLexiconRow[]> {
  const lexicon: ContextLexiconRow[] = [];
  let offset = 0;

  while (lexicon.length < MAX_LEXICON_ENTRIES) {
    const page = await listLanguageLexicalEntries(profileId, {
      languageTag,
      offset,
      limit: LEXICON_PAGE_SIZE,
    });
    if (isDisposed()) return [];

    for (const entry of page.items) {
      if (lexicon.length >= MAX_LEXICON_ENTRIES) break;
      const state = entry.knowledgeState;
      if (!state || !VALID_STATES.has(state as LanguageKnowledgeState)) continue;
      lexicon.push({
        entryId: entry.id,
        surface: entry.canonicalForm || entry.normalizedForm,
        lemma: entry.lemma,
        state: state as LanguageKnowledgeState,
        evidenceCount: entry.activeEvidenceCount + entry.passiveEvidenceCount,
      });
    }

    if (!page.hasMore || page.items.length === 0) break;
    offset += page.items.length;
  }

  return lexicon;
}

/** Opens the existing bounded TutorSheet from reader/video/peek action events. */
export function LanguageTutorHost() {
  const { t } = useI18n();
  const { snapshot } = useLanguageLearningHost();
  const ai = useAiAvailability("prompt");
  const hasByoProvider = useLLMProvidersStore((state) =>
    state.providers.some((provider) => provider.enabled && (provider.apiKey ?? "").trim().length > 0),
  );
  const tutorService = useMemo(() => createProductionLanguageTutorService(), []);
  const tutorSessions = useTutorSessionsStore((state) => state.entries);
  const deleteTutorSession = useTutorSessionsStore((state) => state.deleteSession);
  const clearTutorSessions = useTutorSessionsStore((state) => state.clearSessions);
  const exportTutorSessions = useTutorSessionsStore((state) => state.exportSessions);

  const handleExportTutorSessions = () => {
    if (typeof URL === "undefined" || !URL.createObjectURL || typeof document === "undefined") return;
    const blob = new Blob([exportTutorSessions()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tutor-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [context, setContext] = useState<ReturnType<typeof buildLearnerContext> | null>(null);
  const [mode, setMode] = useState<TutorMode>("explain");
  const [contextStatus, setContextStatus] = useState<"idle" | "loading" | "ready" | "stale" | "failed">("idle");
  const [cloudConsent, setCloudConsent] = useState<boolean | null>(null);
  const [modeResult, setModeResult] = useState<TutorResponse | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [modeRunning, setModeRunning] = useState(false);
  const modeAbortRef = useRef<AbortController | null>(null);

  const cloudConfig = getActiveCloudConfig();
  const isLocalEndpoint = cloudConfig
    ? providerAllowsKeylessAccess(cloudConfig.provider, cloudConfig.baseUrl)
    : false;
  const privacyPolicy = resolveTutorPrivacyPolicy({
    aiPath: ai.path,
    cloudConsent,
    hasByoProvider,
    isLocalEndpoint,
  });

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (detail?.hostId === snapshot.hostId && detail.action === "tutor") {
        modeAbortRef.current?.abort();
        setRequest(detail);
        setMode("explain");
        setModeResult(null);
        setModeError(null);
      }
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  useEffect(() => () => {
    modeAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!request || snapshot.status !== "ready" || !snapshot.profile) {
      setContext(null);
      setContextStatus("idle");
      return () => {
        disposed = true;
      };
    }
    if (
      request.source.contentId !== snapshot.source.contentId ||
      (request.source.contentFingerprint &&
        snapshot.source.contentFingerprint &&
        request.source.contentFingerprint !== snapshot.source.contentFingerprint)
    ) {
      setContext(null);
      setContextStatus("stale");
      return () => {
        disposed = true;
      };
    }
    setContextStatus("loading");
    void loadPaginatedLearnerLexicon(
      snapshot.profile.id,
      snapshot.profile.targetLanguage,
      () => disposed,
    )
      .then((lexicon) => {
        if (disposed) return;
        setContext(
          buildLearnerContext({
            profile: {
              id: snapshot.profile!.id,
              targetLanguage: snapshot.profile!.targetLanguage,
              baseLanguage: snapshot.profile!.baseLanguage,
              proficiency: snapshot.profile!.proficiency,
            },
            lexicon,
            currentSource: request.source.text
              ? { documentId: request.source.contentId, text: request.source.text }
              : undefined,
            budget: { maxItems: 24, maxTextCodeUnits: 1200, includeSourceText: false },
          }),
        );
        setContextStatus("ready");
      })
      .catch(() => {
        if (!disposed) {
          setContext(null);
          setContextStatus("failed");
        }
      });
    return () => {
      disposed = true;
    };
  }, [request, snapshot.profile, snapshot.source.contentFingerprint, snapshot.source.contentId, snapshot.status]);

  const handleClose = useCallback(() => {
    modeAbortRef.current?.abort();
    setModeRunning(false);
    setModeResult(null);
    setModeError(null);
    setRequest(null);
  }, []);

  const runLanguageModePrompt = useCallback(
    async (targetMode: TutorMode) => {
      if (!request || !snapshot.profile || !context) return;
      if (privacyPolicy.requiresConsent && !privacyPolicy.consented) {
        setModeError("Cloud consent is required before sending tutor context off-device.");
        return;
      }
      const materialText = (request.selectedText ?? request.source.text ?? "").trim();
      if (!materialText) return;

      modeAbortRef.current?.abort();
      const controller = new AbortController();
      modeAbortRef.current = controller;
      setModeRunning(true);
      setModeError(null);

      try {
        const response = await tutorService.respond({
          profileId: snapshot.profile.id,
          mode: targetMode,
          message: materialText,
          context,
          signal: controller.signal,
          cloudConsent: privacyPolicy.sendsMaterialOffDevice ? privacyPolicy.consented : undefined,
          privacy: privacyPolicy.sendsMaterialOffDevice && privacyPolicy.consented ? "allow-cloud" : "local-only",
        });
        if (!controller.signal.aborted) {
          setModeResult(response);
          useTutorSessionsStore.getState().addSession({
            profileId: snapshot.profile.id,
            mode: targetMode,
            promptExcerpt: materialText,
            responseExcerpt: response.text,
            attribution: response.attribution,
            privacyPath: response.privacyPath ?? (privacyPolicy.sendsMaterialOffDevice && privacyPolicy.consented ? "cloud" : "local"),
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setModeError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!controller.signal.aborted) {
          setModeRunning(false);
        }
      }
    },
    [context, privacyPolicy.consented, privacyPolicy.requiresConsent, privacyPolicy.sendsMaterialOffDevice, request, snapshot.profile, tutorService],
  );

  if (!request || snapshot.status !== "ready" || !snapshot.profile) return null;
  if (contextStatus === "stale") {
    return (
      <div className="fixed inset-x-4 bottom-20 z-[75] mx-auto max-w-lg rounded-xl border border-amber-500/40 bg-card p-3 text-sm shadow-xl" role="alert">
        <p className="font-medium">Tutor source changed</p>
        <p className="mt-1 text-xs text-muted-foreground">This explanation was selected from an older source fingerprint. Refresh it before asking a source-grounded question.</p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setRequest(null)}>Close</button>
          <button type="button" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground" onClick={() => setRequest((previous) => previous ? { ...previous, source: snapshot.source, sourceAnchor: snapshot.source.source } : previous)}>Refresh source</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <TutorSheet
        open
        material={request.selectedText ?? request.source.text ?? ""}
        documentId={request.source.contentId}
        languageContext={context ?? undefined}
        languageMode={mode}
        onLanguageModeChange={(nextMode) => {
          setMode(nextMode);
          setModeResult(null);
          setModeError(null);
        }}
        onWritingPractice={(text) => dispatchLanguageHostAction({ action: "practice", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile.id, languageTag: snapshot.profile.targetLanguage, practiceMode: "writing", origin: "tutor" })}
        selectionContext={request.sourceAnchor}
        onClose={handleClose}
      />
      <aside
        aria-label="Language tutor mode controls"
        data-language-tutor-controls="true"
        data-privacy-path={privacyPolicy.path}
        className="fixed inset-x-4 top-2 z-[10000] mx-auto max-w-2xl rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="language-tutor-host-mode" className="font-medium text-foreground">
              Mode
            </label>
            <select
              id="language-tutor-host-mode"
              aria-label="All language tutor modes"
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as TutorMode;
                setMode(nextMode);
                setModeResult(null);
                setModeError(null);
              }}
            >
              {TUTOR_MODE_METADATA.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!context || modeRunning || !tutorService.supports(mode) || ai.path === "none" || (privacyPolicy.requiresConsent && !privacyPolicy.consented)}
              onClick={() => void runLanguageModePrompt(mode)}
              className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {modeRunning ? "Running…" : "Quick ask"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {context?.lexiconSummary && (
              <span data-tutor-lexicon-summary="true">
                {context.lexiconSummary.knownCount} known · {context.lexiconSummary.learningCount} learning ({context.lexiconSummary.totalEntries} total)
              </span>
            )}
            <span data-tutor-host-privacy="true">
              {privacyPolicy.path === "local"
                ? "Local AI"
                : privacyPolicy.path === "none"
                  ? "No AI provider"
                  : privacyPolicy.consented
                    ? "Cloud consented"
                    : "Cloud consent needed"}
            </span>
            {privacyPolicy.requiresConsent && !privacyPolicy.consented && (
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted"
                onClick={() => setCloudConsent(true)}
              >
                Allow cloud
              </button>
            )}
          </div>
        </div>
        {modeError && (
          <p className="mt-1.5 text-[11px] text-destructive" role="alert">
            {modeError}
          </p>
        )}
        {modeResult && (
          <div className="mt-1.5 rounded-lg border border-border/70 bg-muted/40 p-2 text-xs text-foreground" data-tutor-mode-result={mode}>
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>{mode} · {modeResult.attribution} · {modeResult.privacyPath ?? privacyPolicy.path}</span>
              <button type="button" className="hover:text-foreground" onClick={() => setModeResult(null)}>
                Dismiss
              </button>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{modeResult.text}</p>
          </div>
        )}
        <div className="mt-2 border-t border-border/50 pt-1.5" data-tutor-sessions="true">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("languageLearning.tutor.history")}</span>
            {tutorSessions.length > 0 && (
              <span className="flex gap-1.5">
                <button type="button" className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted" onClick={handleExportTutorSessions}>
                  {t("languageLearning.tutor.export")}
                </button>
                <button type="button" className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted" onClick={clearTutorSessions}>
                  {t("languageLearning.tutor.clear")}
                </button>
              </span>
            )}
          </div>
          {tutorSessions.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("languageLearning.tutor.historyEmpty")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {tutorSessions.slice(0, 5).map((session) => (
                <li key={session.id} className="flex items-start justify-between gap-2 rounded border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]">
                  <div className="min-w-0">
                    <div className="truncate text-foreground">
                      {TUTOR_MODE_METADATA.find((item) => item.mode === session.mode)?.label ?? session.mode} · {session.attribution} · {session.privacyPath}
                    </div>
                    <div className="truncate text-muted-foreground">{session.responseExcerpt}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("languageLearning.tutor.delete")}
                    className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => deleteTutorSession(session.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

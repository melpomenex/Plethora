import { useCallback, useEffect, useState } from "react";
import { BookOpen, PencilSimple, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { isAnyAiAvailable } from "../../../lib/ai/provider";
import {
  CONTENT_GENERATION_MODES,
  LanguageContentGenerationService,
  createAiLanguageContentGenerator,
  type ContentGenerationMode,
} from "../../../lib/languageContentGeneration";
import { listLanguageGeneratedDocuments, recordLanguageGeneratedDocument } from "../../../api/languageEcosystem";
import { buildLearnerContext } from "../../../lib/languageTutor/context";

const MODE_LABEL_KEYS: Record<ContentGenerationMode, string> = {
  "short-story": "languageLearning.content.mode.shortStory",
  article: "languageLearning.content.mode.article",
  dialogue: "languageLearning.content.mode.dialogue",
  "explanatory-passage": "languageLearning.content.mode.explanatory",
  "graded-reader": "languageLearning.content.mode.gradedReader",
  "vocabulary-reinforcement": "languageLearning.content.mode.vocabulary",
  "grammar-focus": "languageLearning.content.mode.grammar",
  "comprehension-exercise": "languageLearning.content.mode.comprehension",
  "listening-passage": "languageLearning.content.mode.listening",
  "personalized-conversation": "languageLearning.content.mode.conversation",
};

/** Content & Generation hub: lists generated documents and gates AI generation honestly. */
export function LanguageContentHubView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const profileId = activeProfile?.id ?? null;

  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listLanguageGeneratedDocuments>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<ContentGenerationMode>("short-story");
  const [topic, setTopic] = useState("");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let current = true;
    if (!profileId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listLanguageGeneratedDocuments(profileId)
      .then((result) => {
        if (current) setDocuments(result);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    void isAnyAiAvailable("prompt").then((available) => {
      if (current) setAiAvailable(available);
    });
    return () => {
      current = false;
    };
  }, [profileId]);

  const runGeneration = useCallback(async () => {
    if (!profileId || !activeProfile) return;
    setGenerating(true);
    setError(null);
    const controller = new AbortController();
    try {
      const service = new LanguageContentGenerationService([createAiLanguageContentGenerator()]);
      const context = buildLearnerContext({
        profile: {
          id: activeProfile.id,
          targetLanguage: activeProfile.targetLanguage,
          baseLanguage: activeProfile.baseLanguage,
          proficiency: activeProfile.proficiency,
        },
        lexicon: [],
      });
      const generated = await service.generate({
        requestId: `hub:${Date.now()}`,
        profileId,
        action: mode,
        topic: topic.trim(),
        targetLanguage: activeProfile.targetLanguage,
        baseLanguage: activeProfile.baseLanguage,
        proficiency: activeProfile.proficiency,
        length,
        learnerContext: context,
        privacy: "local-only",
        allowCloud: false,
        signal: controller.signal,
      });
      await recordLanguageGeneratedDocument({
        profileId,
        documentId: generated.documentId,
        sourceDocumentId: generated.sourceDocumentId,
        actionKind: mode,
        targetCoverage: generated.claimedCoveragePercent,
        measuredCoverage: generated.measuredCoveragePercent,
        providerId: generated.providerId,
        modelId: generated.modelId,
        promptSummary: `${generated.title} · ${topic.trim()}`,
        provenance: { generatedFingerprint: generated.generatedFingerprint, createdAt: generated.createdAt },
      });
      setDialogOpen(false);
      setTopic("");
      setDocuments((prev) => [
        {
          id: generated.documentId,
          profileId,
          documentId: generated.documentId,
          sourceDocumentId: generated.sourceDocumentId,
          actionKind: mode,
          targetCoverage: generated.claimedCoveragePercent,
          measuredCoverage: generated.measuredCoveragePercent,
          providerId: generated.providerId,
          modelId: generated.modelId,
          promptSummary: generated.title,
          provenance: { generatedFingerprint: generated.generatedFingerprint },
          createdAt: generated.createdAt,
        },
        ...prev,
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  }, [profileId, activeProfile, mode, topic, length]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-300">
          <PencilSimple className="h-4 w-4 text-emerald-400" />
          {t("languageLearning.content.title")}
        </h3>
        <button
          type="button"
          disabled={!aiAvailable}
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          <Sparkle className="h-4 w-4" />
          {t("languageLearning.content.generate")}
        </button>
      </div>

      {!aiAvailable ? (
        <p className="rounded-lg bg-stone-800/60 p-4 text-sm text-stone-400 ring-1 ring-inset ring-stone-700/60">
          {t("languageLearning.content.noAi")}
        </p>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <WarningCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-stone-400">{t("languageLearning.loading")}</p>
      ) : documents.length === 0 ? (
        <p className="rounded-lg bg-stone-800/60 p-4 text-sm text-stone-400 ring-1 ring-inset ring-stone-700/60">
          {t("languageLearning.content.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-stone-800 rounded-xl ring-1 ring-inset ring-stone-800 bg-stone-900/40">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 shrink-0 text-stone-500" />
                  <span className="truncate text-sm font-medium text-stone-100">{doc.promptSummary ?? doc.documentId}</span>
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {t(`languageLearning.content.mode.${doc.actionKind}`)} · {new Date(doc.createdAt).toLocaleDateString()}
                </div>
              </div>
              {doc.documentId ? (
                <span className="rounded-full bg-stone-800 px-3 py-1 text-xs text-stone-400 ring-1 ring-inset ring-stone-700">
                  {t("languageLearning.content.generated")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-stone-900 p-5 ring-1 ring-inset ring-stone-700 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("languageLearning.content.generateTitle")}</h3>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label={t("common.close")} className="rounded-full p-1.5 text-stone-400 hover:bg-stone-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-400" htmlFor="content-mode">
                  {t("languageLearning.content.modeLabel")}
                </label>
                <select id="content-mode" value={mode} onChange={(event) => setMode(event.target.value as ContentGenerationMode)} className="w-full rounded-lg bg-stone-800 px-3 py-2 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 focus:outline-none focus:ring-emerald-500">
                  {CONTENT_GENERATION_MODES.map((candidate) => (
                    <option key={candidate} value={candidate}>{t(MODE_LABEL_KEYS[candidate])}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-400" htmlFor="content-topic">
                  {t("languageLearning.content.topicLabel")}
                </label>
                <input
                  id="content-topic"
                  type="text"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder={t("languageLearning.content.topicPlaceholder")}
                  className="w-full rounded-lg bg-stone-800 px-3 py-2 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 placeholder:text-stone-500 focus:outline-none focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-400">{t("languageLearning.content.lengthLabel")}</label>
                <div className="flex gap-2">
                  {(["short", "medium", "long"] as const).map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => setLength(candidate)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                        length === candidate
                          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
                          : "bg-stone-800 text-stone-300 ring-stone-700 hover:bg-stone-700"
                      }`}
                    >
                      {t(`languageLearning.content.length.${candidate}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={generating || !topic.trim()}
                onClick={() => void runGeneration()}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                <Sparkle className="h-4 w-4" />
                {generating ? t("languageLearning.content.generating") : t("languageLearning.content.generate")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

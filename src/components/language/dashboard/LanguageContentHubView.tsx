import { useCallback, useEffect, useState } from "react";
import { BookOpen, PencilSimple, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useIsActiveTab } from "../../common/Tabs/TabContent";
import { Dialog } from "../../md3/Dialog";
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
  const isActiveTab = useIsActiveTab();
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
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PencilSimple className="h-4 w-4 text-primary" />
          {t("languageLearning.content.title")}
        </h3>
        <button
          type="button"
          disabled={!aiAvailable}
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground md-state md-focus-ring disabled:opacity-40"
        >
          <Sparkle className="h-4 w-4" />
          {t("languageLearning.content.generate")}
        </button>
      </div>

      {!aiAvailable ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
          {t("languageLearning.content.noAi")}
        </p>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <WarningCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("languageLearning.loading")}</p>
      ) : documents.length === 0 ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
          {t("languageLearning.content.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl ring-1 ring-inset ring-border bg-card">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium text-foreground">{doc.promptSummary ?? doc.documentId}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t(`languageLearning.content.mode.${doc.actionKind}`)} · {new Date(doc.createdAt).toLocaleDateString()}
                </div>
              </div>
              {doc.documentId ? (
                <span className="rounded-full bg-surface-container px-3 py-1 text-xs text-muted-foreground ring-1 ring-inset ring-border">
                  {t("languageLearning.content.generated")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={dialogOpen && isActiveTab}
        onClose={() => setDialogOpen(false)}
        title={t("languageLearning.content.generateTitle")}
        closeLabel={t("common.close")}
        footer={(
          <>
            <button type="button" onClick={() => setDialogOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-container">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={generating || !topic.trim()}
              onClick={() => void runGeneration()}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground md-state md-focus-ring disabled:opacity-40"
            >
              <Sparkle className="h-4 w-4" />
              {generating ? t("languageLearning.content.generating") : t("languageLearning.content.generate")}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="content-mode">
              {t("languageLearning.content.modeLabel")}
            </label>
            <select id="content-mode" value={mode} onChange={(event) => setMode(event.target.value as ContentGenerationMode)} className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-border md-focus-ring focus-visible:ring-primary">
              {CONTENT_GENERATION_MODES.map((candidate) => (
                <option key={candidate} value={candidate}>{t(MODE_LABEL_KEYS[candidate])}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="content-topic">
              {t("languageLearning.content.topicLabel")}
            </label>
            <input
              id="content-topic"
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={t("languageLearning.content.topicPlaceholder")}
              className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-border placeholder:text-muted-foreground md-focus-ring focus-visible:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("languageLearning.content.lengthLabel")}</label>
            <div className="flex gap-2">
              {(["short", "medium", "long"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={length === candidate}
                  onClick={() => setLength(candidate)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                    length === candidate
                      ? "bg-secondary-container text-on-secondary-container ring-primary/40"
                      : "bg-surface-container text-foreground ring-border hover:bg-surface-container-highest"
                  }`}
                >
                  {t(`languageLearning.content.length.${candidate}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

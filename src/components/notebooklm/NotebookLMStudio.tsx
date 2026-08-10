import { useState, useEffect } from "react";
import { useI18n } from "../../lib/i18n";
import { isTauri } from "../../lib/tauri";
import { useToast } from "../common/Toast";
import { useCollectionStore } from "../../stores/collectionStore";
import {
  ArrowsClockwise,
  Brain,
  CaretDown,
  CaretUp,
  Check,
  CircleNotch,
  Eye,
  FileText,
  Headphones,
  ImageSquare,
  MapTrifold,
  PresentationChart,
  Sparkle,
  Stack,
  Table,
  TextT,
  Upload,
  Video,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  notebooklmGenerateArtifact,
  notebooklmGetJobs,
  notebooklmPreviewFlashcards,
  notebooklmPreviewQuizImport,
  notebooklmSyncPreviewItems,
  notebooklmExportJobArtifact,
  notebooklmImportJobArtifact,
  type NotebookLMJob,
  type ImportPreviewItem,
} from "../../api/integrations";
import {
  STUDIO_ARTIFACT_TYPES,
  ARTIFACT_TYPE_OPTION_FIELDS,
  normalizeArtifactType,
  canViewArtifactType,
  canImportArtifactType,
  isPayloadBackedArtifactType,
  assertArtifactTypeCoverage,
  type ArtifactGenerationOptions,
  type StudioArtifactType,
} from "./artifactTypes";

interface NotebookLMStudioProps {
  notebookId: string;
  onSyncToIncrementum?: (items: ImportPreviewItem[]) => void;
  onViewArtifact?: (job: NotebookLMJob) => void;
}

/**
 * Per-tile display metadata keyed by canonical artifact type. The tile set
 * itself is driven by STUDIO_ARTIFACT_TYPES (single source of truth); this
 * map only supplies presentation data (label, icon, color).
 */
const TILE_METADATA: Record<
  StudioArtifactType,
  { labelKey: string; descKey: string; icon: typeof Stack; color: string }
> = {
  flashcards: {
    labelKey: "notebooklmStudio.flashcards",
    descKey: "notebooklmStudio.flashcardsDesc",
    icon: Stack,
    color: "bg-blue-500",
  },
  quiz: {
    labelKey: "notebooklmStudio.quiz",
    descKey: "notebooklmStudio.quizDesc",
    icon: Brain,
    color: "bg-purple-500",
  },
  audio: {
    labelKey: "notebooklmStudio.audioOverview",
    descKey: "notebooklmStudio.audioOverviewDesc",
    icon: Headphones,
    color: "bg-emerald-500",
  },
  video: {
    labelKey: "notebooklmStudio.videoOverview",
    descKey: "notebooklmStudio.videoOverviewDesc",
    icon: Video,
    color: "bg-pink-500",
  },
  "study-guide": {
    labelKey: "notebooklmStudio.studyGuide",
    descKey: "notebooklmStudio.studyGuideDesc",
    icon: TextT,
    color: "bg-amber-500",
  },
  report: {
    labelKey: "notebooklmStudio.report",
    descKey: "notebooklmStudio.reportDesc",
    icon: FileText,
    color: "bg-orange-500",
  },
  "mind-map": {
    labelKey: "notebooklmStudio.mindMap",
    descKey: "notebooklmStudio.mindMapDesc",
    icon: MapTrifold,
    color: "bg-cyan-500",
  },
  "data-table": {
    labelKey: "notebooklmStudio.dataTable",
    descKey: "notebooklmStudio.dataTableDesc",
    icon: Table,
    color: "bg-indigo-500",
  },
  "slide-deck": {
    labelKey: "notebooklmStudio.slideDeck",
    descKey: "notebooklmStudio.slideDeckDesc",
    icon: PresentationChart,
    color: "bg-teal-500",
  },
  infographic: {
    labelKey: "notebooklmStudio.infographic",
    descKey: "notebooklmStudio.infographicDesc",
    icon: ImageSquare,
    color: "bg-rose-500",
  },
};

/** Every tile must resolve in the import map and the backend dispatch. */
assertArtifactTypeCoverage();

/** Whether a job's artifact is payload-backed and eligible for export. */
const canExportArtifact = (job: NotebookLMJob): boolean =>
  job.status === "succeeded" && isPayloadBackedArtifactType(job.artifactType);

export function NotebookLMStudio({ notebookId, onSyncToIncrementum, onViewArtifact }: NotebookLMStudioProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [jobs, setJobs] = useState<NotebookLMJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [optionPanelType, setOptionPanelType] = useState<StudioArtifactType | null>(null);
  const [genOptions, setGenOptions] = useState<ArtifactGenerationOptions>({});
  const [selectedJob, setSelectedJob] = useState<NotebookLMJob | null>(null);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [previewMode, _setPreviewMode] = useState<"all" | "missed-only">("all");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showJobs, setShowJobs] = useState(true);
  const [deckName, setDeckName] = useState("NotebookLM Imports");
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (notebookId) {
      loadJobs();
    }
  }, [notebookId]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const data = await notebooklmGetJobs(20);
      setJobs(data);
    } catch (error) {
      console.error("Failed to load jobs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async (
    artifactType: string,
    options?: ArtifactGenerationOptions
  ) => {
    if (!notebookId) return;
    setGeneratingType(artifactType);
    try {
      await notebooklmGenerateArtifact({
        notebookId,
        artifactType,
        retryCount: 1,
        ...(options ?? {}),
      });
      await loadJobs();
    } catch (error) {
      console.error("Failed to generate artifact:", error);
    } finally {
      setGeneratingType(null);
      setOptionPanelType(null);
      setGenOptions({});
    }
  };

  const handleTileClick = (typeId: StudioArtifactType) => {
    const optionFields = ARTIFACT_TYPE_OPTION_FIELDS[typeId];
    if (optionFields && optionFields.length > 0) {
      // Types with options open the options panel instead of generating
      // immediately, so the user can pick format/length/orientation first.
      setGenOptions({});
      setOptionPanelType((prev) => (prev === typeId ? null : typeId));
      return;
    }
    void handleGenerate(typeId);
  };

  const handleSelectJob = async (job: NotebookLMJob) => {
    setSelectedJob(job);
    setImportResult(null);
    setImportError(null);
    // Flashcards and quiz can be imported via the existing preview+sync flow.
    const isFlashcardsOrQuiz =
      normalizeArtifactType(job.artifactType) === "flashcards" ||
      normalizeArtifactType(job.artifactType) === "quiz";
    if (isFlashcardsOrQuiz && job.status === "succeeded") {
      setIsPreviewLoading(true);
      try {
        let preview: ImportPreviewItem[];
        if (normalizeArtifactType(job.artifactType) === "quiz") {
          preview = await notebooklmPreviewQuizImport(job.id, previewMode);
        } else {
          preview = await notebooklmPreviewFlashcards(job.id);
        }
        setPreviewItems(preview);
      } catch (error) {
        console.error("Failed to load preview:", error);
        setPreviewItems([]);
      } finally {
        setIsPreviewLoading(false);
      }
    }
  };

  const handleImportArtifact = async (job: NotebookLMJob) => {
    if (!job) return;
    setIsImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const activeCollectionId = useCollectionStore.getState().activeCollectionId;
      const result = await notebooklmImportJobArtifact(job.id, activeCollectionId || undefined);
      setImportResult(result.title);
    } catch (error: any) {
      setImportError(error?.message || t("notebooklmStudio.importFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async (format: "json" | "markdown" | "html") => {
    if (!selectedJob) return;
    try {
      const result = await notebooklmExportJobArtifact(selectedJob.id, format);
      // Save via the native dialog when running under Tauri; fall back to a
      // browser download otherwise.
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const extension = format === "json" ? "json" : format === "markdown" ? "md" : "html";
        const filePath = await save({
          title: t("notebooklmStudio.exportTitle"),
          defaultPath: result.fileName,
          filters: [{ name: format.toUpperCase(), extensions: [extension] }],
        });
        if (!filePath) return; // cancelled picker is a no-op
        await writeTextFile(filePath, result.content);
        toast.success(t("notebooklmStudio.exportSuccess"), filePath);
      } else {
        const blob = new Blob([result.content], { type: result.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke on the next tick so Firefox does not cancel the download.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error: any) {
      toast.error(t("notebooklmStudio.exportFailed"), error?.message || String(error));
    }
  };

  const handleSync = async () => {
    if (previewItems.length === 0) return;
    try {
      const result = await notebooklmSyncPreviewItems({
        previewItems,
        deckName: deckName || "NotebookLM Imports",
        dedupe: true,
      });
      setSyncResult(result);
      onSyncToIncrementum?.(previewItems);
    } catch (error) {
      console.error("Failed to sync:", error);
    }
  };

  const updatePreviewItem = (index: number, field: "question" | "answer", value: string) => {
    const updated = [...previewItems];
    updated[index] = { ...updated[index], [field]: value };
    setPreviewItems(updated);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "succeeded":
        return <Check className="w-4 h-4 text-green-500" />;
      case "failed":
        return <WarningCircle className="w-4 h-4 text-red-500" />;
      case "running":
        return <CircleNotch className="w-4 h-4 animate-spin text-blue-500" />;
      default:
        return <CircleNotch className="w-4 h-4 animate-spin text-muted-foreground" />;
    }
  };

  const getArtifactTypeInfo = (type: string) => {
    const canonical = normalizeArtifactType(type);
    const meta = TILE_METADATA[canonical as StudioArtifactType] || {
      labelKey: canonical,
      descKey: "",
      icon: Sparkle,
      color: "bg-gray-500",
    };
    return meta;
  };

  const canViewArtifact = (job: NotebookLMJob): boolean => canViewArtifactType(job.artifactType);

  /**
   * Import is offered only for succeeded jobs whose artifact type has an
   * import path. Flashcards/quiz import through the sync flow, not this
   * command, so they are excluded here too.
   */
  const canImportArtifact = (job: NotebookLMJob): boolean =>
    job.status === "succeeded" && canImportArtifactType(job.artifactType);

  return (
    <div className="w-96 bg-card border-l border-border flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkle className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{t("notebooklmStudio.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("notebooklmStudio.generateStudyMaterials")}</p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Generate Section */}
        <div className="p-4">
          <h4 className="text-sm font-medium text-foreground mb-3">{t("notebooklmStudio.create")}</h4>
          <div className="grid grid-cols-2 gap-2">
            {STUDIO_ARTIFACT_TYPES.map((typeId) => {
              const meta = TILE_METADATA[typeId];
              const Icon = meta.icon;
              const isGenerating = generatingType === typeId;
              const optionPanelOpen = optionPanelType === typeId;
              return (
                <button
                  key={typeId}
                  onClick={() => handleTileClick(typeId)}
                  disabled={isGenerating || !notebookId}
                  className={`flex flex-col items-center gap-2 p-3 bg-background border rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50 text-left ${
                    optionPanelOpen ? "border-primary/60 bg-primary/5" : "border-border"
                  }`}
                >
                  <div className={`w-8 h-8 ${meta.color} rounded-lg flex items-center justify-center`}>
                    {isGenerating ? (
                      <CircleNotch className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-foreground">{t(meta.labelKey)}</p>
                    <p className="text-[10px] text-muted-foreground">{meta.descKey ? t(meta.descKey) : ""}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Per-type generation options panel */}
          {optionPanelType && (
            <div className="mt-3 p-3 bg-muted rounded-lg border border-border">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-xs font-semibold text-foreground">
                  {t("notebooklmStudio.generationOptions")}
                </h5>
                <button
                  onClick={() => setOptionPanelType(null)}
                  className="p-1 hover:bg-background rounded transition-colors"
                  aria-label={t("common.close")}
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
              {ARTIFACT_TYPE_OPTION_FIELDS[optionPanelType]?.map((field) => (
                <div key={field.key} className="mb-2">
                  <label className="block text-xs text-muted-foreground mb-1">
                    {t(`notebooklmStudio.option.${field.key}`)}
                  </label>
                  {field.choices.length > 0 ? (
                    <select
                      value={(genOptions[field.key] as string) || ""}
                      onChange={(e) =>
                        setGenOptions((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">{t("notebooklmStudio.optionDefault")}</option>
                      {field.choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {t(`notebooklmStudio.option.${field.key}.${choice}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={(genOptions[field.key] as string) || ""}
                      onChange={(e) =>
                        setGenOptions((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={t(`notebooklmStudio.option.${field.key}.placeholder`)}
                      className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  )}
                </div>
              ))}
              <button
                onClick={() => void handleGenerate(optionPanelType, genOptions)}
                disabled={generatingType === optionPanelType}
                className="w-full mt-1 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
              >
                {generatingType === optionPanelType ? (
                  <>
                    <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                    {t("notebooklmStudio.generating")}
                  </>
                ) : (
                  t("notebooklmStudio.generate")
                )}
              </button>
            </div>
          )}
        </div>

        {/* Jobs Section */}
        <div className="border-t border-border">
          <button
            onClick={() => setShowJobs(!showJobs)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{t("notebooklmStudio.recentJobs")}</span>
              {jobs.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded-full">
                  {jobs.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  loadJobs();
                }}
                disabled={isLoading}
                className="p-1 hover:bg-background rounded transition-colors"
              >
                <ArrowsClockwise className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
              </button>
              {showJobs ? (
                <CaretUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <CaretDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>

          {showJobs && (
            <div className="px-4 pb-4 space-y-2 max-h-48 overflow-y-auto">
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("notebooklmStudio.noJobsYet")}
                </p>
              ) : (
                jobs.map((job) => {
                  const typeInfo = getArtifactTypeInfo(job.artifactType);
                  const Icon = typeInfo.icon;
                  const isSelected = selectedJob?.id === job.id;

                  return (
                    <div
                      key={job.id}
                      className={`w-full flex items-center gap-2 p-2.5 rounded-lg text-left transition-colors ${
                        isSelected
                          ? "bg-primary/10 border border-primary/20"
                          : "bg-background border border-border hover:border-primary/30"
                      }`}
                    >
                      <button
                        onClick={() => handleSelectJob(job)}
                        className="flex-1 flex items-center gap-2 min-w-0"
                      >
                        <div className={`w-8 h-8 ${typeInfo.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {t(typeInfo.labelKey)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(job.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-1">
                        {getStatusIcon(job.status)}
                        {canViewArtifact(job) && (
                          <button
                            onClick={() => onViewArtifact?.(job)}
                            className="p-1.5 hover:bg-background rounded-md transition-colors"
                            title={t("notebooklmStudio.viewArtifact")}
                          >
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Preview Section */}
        {selectedJob && (
          <div className="border-t border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-foreground">{t("notebooklmStudio.preview")}</h4>
              <div className="flex items-center gap-1">
                {canExportArtifact(selectedJob) && (
                  <>
                    <button
                      onClick={() => handleExport("json")}
                      className="p-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      title={t("notebooklmStudio.exportJson")}
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => handleExport("markdown")}
                      className="p-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      title={t("notebooklmStudio.exportMarkdown")}
                    >
                      MD
                    </button>
                    <button
                      onClick={() => handleExport("html")}
                      className="p-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      title={t("notebooklmStudio.exportHtml")}
                    >
                      HTML
                    </button>
                  </>
                )}
              </div>
            </div>

            {(normalizeArtifactType(selectedJob.artifactType) === "flashcards" ||
              normalizeArtifactType(selectedJob.artifactType) === "quiz") ? (
              <>
                {isPreviewLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <CircleNotch className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : previewItems.length > 0 ? (
                  <>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={deckName}
                        onChange={(e) => setDeckName(e.target.value)}
                        aria-label="Deck name"
                        placeholder={t("notebooklmStudio.deckNamePlaceholder")}
                        className="w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {previewItems.map((item, idx) => (
                        <div
                          key={`${item.sourceArtifactId}-${idx}`}
                          className="p-3 bg-background border border-border rounded-lg"
                        >
                          <input
                            value={item.question}
                            onChange={(e) => updatePreviewItem(idx, "question", e.target.value)}
                            aria-label={`Question ${idx + 1}`}
                            className="w-full px-2 py-1 text-sm font-medium bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary/50 rounded"
                          />
                          <textarea
                            value={item.answer}
                            onChange={(e) => updatePreviewItem(idx, "answer", e.target.value)}
                            aria-label={`Answer ${idx + 1}`}
                            className="w-full px-2 py-1 text-sm text-muted-foreground bg-transparent border-none resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 rounded mt-1"
                            rows={2}
                          />
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleSync}
                      className="w-full mt-3 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      {t("notebooklmStudio.syncToIncrementum")}
                    </button>

                    {syncResult && (
                      <div className="mt-2 text-xs text-center text-green-600">
                        Created: {syncResult.created}, Updated: {syncResult.updated}, Skipped: {syncResult.skipped}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t("notebooklmStudio.noPreviewItems")}
                  </p>
                )}
              </>
            ) : canViewArtifact(selectedJob) ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-2">
                  {t("notebooklmStudio.dedicatedViewer")}
                </p>
                <button
                  onClick={() => onViewArtifact?.(selectedJob)}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mx-auto"
                >
                  <Eye className="w-4 h-4" />
                  {t("notebooklmStudio.viewArtifact")}
                </button>
                {canImportArtifact(selectedJob) && (
                  <>
                    <button
                      onClick={() => handleImportArtifact(selectedJob)}
                      disabled={isImporting}
                      className="mt-2 px-4 py-2 border border-border text-sm rounded-lg hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
                    >
                      {isImporting ? (
                        <CircleNotch className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {t("notebooklmStudio.importToLibrary")}
                    </button>
                    {importResult && (
                      <p className="mt-2 text-xs text-green-600" role="status">
                        {t("notebooklmStudio.importSuccess", { title: importResult })}
                      </p>
                    )}
                    {importError && (
                      <p className="mt-2 text-xs text-red-600" role="alert">
                        {importError}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("notebooklmStudio.noPreviewItems")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

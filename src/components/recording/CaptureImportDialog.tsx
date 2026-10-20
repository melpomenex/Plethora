import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  FileAudio,
  FileText,
  Link as LinkIcon,
  Microphone,
  WarningCircle,
} from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { CollectionSelector } from "../collections/CollectionSelector";
import { useCollectionStore } from "../../stores/collectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import { captureController } from "../../services/recording/captureController";
import { sessionController } from "../../services/recording/SessionController";
import {
  importMediaFiles,
  retryFailedImports,
  type ImportMediaBatchResult,
} from "../../services/recording/importMedia";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { useTabsStore } from "../../stores/tabsStore";
import { classifyUrl } from "../../services/recording/urlAdapters";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";

export const LECTURE_CAPTURE_EVENT = "plethora:record-lecture";

export type CaptureRoute = "record" | "import-media" | "import-transcript" | "import-url";

export interface CaptureImportDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
  initialRoute?: CaptureRoute;
}

export function CaptureImportDialog({
  isOpen: propIsOpen,
  onClose: propOnClose,
  initialRoute: propInitialRoute,
}: CaptureImportDialogProps = {}) {
  const { t } = useI18n();
  const storeIsOpen = useUIStore((s) => s.captureImportDialogOpen);
  const storeInitialRoute = useUIStore((s) => s.captureImportInitialRoute);
  const storeInitialData = useUIStore((s) => s.captureImportInitialData);
  const setDialogOpen = useUIStore((s) => s.setCaptureImportDialogOpen);
  const setActiveRecordingOpen = useUIStore((s) => s.setActiveRecordingOpen);

  const isOpen = propIsOpen ?? storeIsOpen;
  const handleClose = () => {
    if (propOnClose) {
      propOnClose();
    } else {
      setDialogOpen(false);
    }
  };

  const [activeRoute, setActiveRoute] = useState<CaptureRoute>(
    propInitialRoute ?? storeInitialRoute ?? "record"
  );

  useEffect(() => {
    if (propInitialRoute) {
      setActiveRoute(propInitialRoute);
    } else if (storeInitialRoute) {
      setActiveRoute(storeInitialRoute);
    }
  }, [propInitialRoute, storeInitialRoute]);

  // Listen for legacy plethora:record-lecture event
  useEffect(() => {
    const onLectureEvent = () => {
      setActiveRoute("record");
      setDialogOpen(true, "record");
    };
    window.addEventListener(LECTURE_CAPTURE_EVENT, onLectureEvent);
    return () => window.removeEventListener(LECTURE_CAPTURE_EVENT, onLectureEvent);
  }, [setDialogOpen]);

  // Form states
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const [collectionId, setCollectionId] = useState(activeCollectionId);
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<"lecture" | "meeting" | "interview" | "study">("lecture");

  // Processing settings
  const [processingExpanded, setProcessingExpanded] = useState(false);
  const [transcribeWhenReady, setTranscribeWhenReady] = useState(true);
  const [prepareStudySuggestions, setPrepareStudySuggestions] = useState(false);

  // File / URL inputs
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; size: number; path: string }>>([]);
  const [batchResult, setBatchResult] = useState<ImportMediaBatchResult | null>(null);
  const [urlInput, setUrlInput] = useState("");

  // Loading & error states
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Focus restore & initial data prefill
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setErrorMessage(null);
      setBatchResult(null);
      if (storeInitialData) {
        if (storeInitialData.title) setTitle(storeInitialData.title);
        else if (storeInitialData.fileName) setTitle(storeInitialData.fileName);
        if (storeInitialData.collectionId) setCollectionId(storeInitialData.collectionId);
        if (storeInitialData.contentType) setContentType(storeInitialData.contentType);
        if (storeInitialData.url) setUrlInput(storeInitialData.url);
        if (storeInitialData.filePaths && storeInitialData.filePaths.length > 0) {
          setSelectedFiles(
            storeInitialData.filePaths.map((p, idx) => ({
              path: p,
              name: storeInitialData.fileNames?.[idx] || p.split("/").pop() || "Shared file",
              size: 0,
            }))
          );
        } else if (storeInitialData.filePath) {
          setSelectedFiles([
            {
              path: storeInitialData.filePath,
              name: storeInitialData.fileName || storeInitialData.filePath.split("/").pop() || "Shared file",
              size: 0,
            },
          ]);
        }
      } else if (!title) {
        setTitle(`Recording ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
      }
    } else if (previousFocusRef.current) {
      try {
        previousFocusRef.current.focus();
      } catch {
        /* ignore */
      }
    }
  }, [isOpen, storeInitialData]);

  const urlDecision = activeRoute === "import-url" && urlInput.trim() ? classifyUrl(urlInput) : null;

  const configuredProvider = useSettingsStore((s) => s.settings.audioTranscription?.mode) || "On device";

  const handleOpenExisting = (documentId?: string) => {
    if (documentId) {
      try {
        openDocumentAtLocation(documentId, {}, (tab) => useTabsStore.getState().addTab(tab));
      } catch (e) {
        console.warn("[CaptureImportDialog] Could not open existing document:", e);
      }
    }
    handleClose();
  };

  const handleCreateSeparate = async (filePath: string) => {
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const singleRes = await importMediaFiles({
        paths: [filePath],
        collectionId,
        contentType,
        duplicateAction: "create-separate",
      });
      if (batchResult) {
        const updatedItems = batchResult.items.map((i) =>
          i.filePath === filePath ? singleRes.items[0] || i : i
        );
        setBatchResult({
          items: updatedItems,
          successCount: updatedItems.filter((i) => i.status === "success").length,
          failedCount: updatedItems.filter((i) => i.status === "failed").length,
          duplicateCount: updatedItems.filter((i) => i.status === "duplicate").length,
        });
        if (updatedItems.every((i) => i.status === "success")) {
          handleClose();
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!batchResult) return;
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const retried = await retryFailedImports(batchResult, {
        collectionId,
        contentType,
      });
      setBatchResult(retried);
      if (retried.failedCount === 0 && retried.duplicateCount === 0) {
        handleClose();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStartRecord = async () => {
    setIsStarting(true);
    setErrorMessage(null);
    try {
      await captureController.start({
        title: title.trim() || undefined,
        contentType,
      });
      handleClose();
      setActiveRecordingOpen(true);
    } catch (err: unknown) {
      console.warn("[CaptureImportDialog] Start recording failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowedError") || msg.includes("denied")) {
        setErrorMessage(t("recording.permissionDenied", "Microphone access was denied. Please allow microphone permission in your system settings."));
      } else if (msg.includes("busy") || msg.includes("CaptureBusy")) {
        setErrorMessage(t("recording.captureBusy", "Microphone is currently in use by another task."));
      } else {
        setErrorMessage(msg || t("recording.startFailed", "Failed to start recording. Please try again."));
      }
    } finally {
      setIsStarting(false);
    }
  };

  const handleImportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (activeRoute === "record") {
      await handleStartRecord();
      return;
    }

    if (activeRoute === "import-media" && (selectedFiles.length > 0 || selectedFile)) {
      const pathsToImport =
        selectedFiles.length > 0
          ? selectedFiles.map((f) => f.path)
          : selectedFile
            ? [(selectedFile as any).path || selectedFile.name]
            : [];

      if (pathsToImport.length === 0) return;

      setIsStarting(true);
      setErrorMessage(null);
      try {
        const res = await importMediaFiles({
          paths: pathsToImport,
          collectionId,
          contentType,
          title: title.trim() || (selectedFile?.name ?? undefined),
        });
        setBatchResult(res);
        if (res.failedCount === 0 && res.duplicateCount === 0) {
          handleClose();
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setIsStarting(false);
      }
      return;
    }

    if (activeRoute === "import-transcript" && selectedFile) {
      setIsStarting(true);
      try {
        await sessionController.createSession({
          origin: "transcript",
          title: title.trim() || selectedFile.name,
          contentType,
          collectionId,
        });
        handleClose();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setIsStarting(false);
      }
      return;
    }

    if (activeRoute === "import-url" && urlInput) {
      const decision = classifyUrl(urlInput);
      if (!decision.isAllowed) {
        setErrorMessage(decision.reason || t("recording.invalidUrl", "Please enter a valid HTTP/HTTPS URL."));
        return;
      }
      setIsStarting(true);
      try {
        await sessionController.createSession({
          origin: "url",
          title: title.trim() || urlInput,
          contentType,
          collectionId,
          profileJson: JSON.stringify({
            urlAdapter: decision.adapter,
            normalizedUrl: decision.normalizedUrl,
            meta: decision.meta,
          }),
        });
        handleClose();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setIsStarting(false);
      }
    }
  };

  const routeChoices = [
    {
      id: "record" as const,
      label: t("recording.recordAudio", "Record Audio"),
      description: t("recording.recordAudioDesc", "Save audio on this device while you record."),
      icon: Microphone,
    },
    {
      id: "import-media" as const,
      label: t("recording.importRecording", "Import Recording"),
      description: t("recording.importRecordingDesc", "Import audio or video files from your device."),
      icon: FileAudio,
    },
    {
      id: "import-transcript" as const,
      label: t("recording.importTranscript", "Import Transcript"),
      description: t("recording.importTranscriptDesc", "SRT, VTT, or plain text. You can study a transcript without audio."),
      icon: FileText,
    },
    {
      id: "import-url" as const,
      label: t("recording.importUrl", "Import Supported URL"),
      description: t("recording.importUrlDesc", "Import from recognized web or media sources."),
      icon: LinkIcon,
    },
  ];

  return (
    <ResponsiveDialogSheet
      open={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <Microphone className="w-5 h-5 text-primary" />
          <span>{t("recording.captureAndImport", "Capture & Import")}</span>
        </div>
      }
      description={t(
        "recording.dialogSubtitle",
        "Record lectures, discussions, or import existing audio and transcripts."
      )}
      className="max-w-xl w-full"
    >
      <form onSubmit={handleImportSubmit} className="space-y-4 pt-1">
        {/* Route Selector List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Capture & Import Route">
          {routeChoices.map((choice) => {
            const Icon = choice.icon;
            const isSelected = activeRoute === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setActiveRoute(choice.id);
                  setErrorMessage(null);
                }}
                className={cn(
                  "flex items-start gap-3 p-3 text-left rounded-xl border transition-all min-h-[56px]",
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "p-2 rounded-lg mt-0.5",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground flex items-center justify-between">
                    <span>{choice.label}</span>
                    {isSelected && <CheckCircle className="w-4 h-4 text-primary" weight="fill" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{choice.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Route Form Details */}
        <div className="mt-4 p-4 rounded-xl border border-border bg-card/50 space-y-3">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("recording.titleLabel", "Title (optional)")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Recording ${new Date().toLocaleDateString()}`}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Collection Picker (Course or project) */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-xs font-medium text-muted-foreground">
              {t("recording.courseOrProject", "Course or project")}
            </label>
            <CollectionSelector
              documentCollectionId={collectionId}
              onCollectionChange={setCollectionId}
            />
          </div>

          {/* Content Type Selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("recording.contentType", "Content type")}
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Content Type">
              {(["lecture", "meeting", "interview", "study"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setContentType(type)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg capitalize border transition-colors",
                    contentType === type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t(`recording.type.${type}`, type)}
                </button>
              ))}
            </div>
          </div>

          {/* Route-specific inputs */}
          {activeRoute === "import-media" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("recording.mediaFile", "Audio or video file")}
              </label>
              <input
                type="file"
                multiple
                accept="audio/*,video/*,.mp3,.m4a,.wav,.flac,.ogg,.webm,.mp4,.mov"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) {
                    setSelectedFiles(
                      files.map((f) => ({
                        name: f.name,
                        size: f.size,
                        path: (f as any).path || f.name,
                      }))
                    );
                    setSelectedFile(files[0]);
                    setBatchResult(null);
                  }
                }}
                className="w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              />
              {selectedFiles.length > 0 && !batchResult && (
                <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                  <p className="text-xs font-medium text-foreground">
                    {selectedFiles.length === 1
                      ? `${selectedFiles[0].name} (${(selectedFiles[0].size / 1024 / 1024).toFixed(1)} MB)`
                      : `${selectedFiles.length} files selected`}
                  </p>
                  {selectedFiles.length > 1 && (
                    <ul className="space-y-1">
                      {selectedFiles.map((f, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground flex items-center justify-between p-1 bg-muted/30 rounded">
                          <span className="truncate max-w-[80%]">{f.name}</span>
                          <span>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {selectedFile && selectedFiles.length === 0 && !batchResult && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </p>
              )}
              {storeInitialData?.fileName && selectedFiles.length === 0 && !selectedFile && (
                <p className="mt-1 text-xs text-primary flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t("recording.sharedMediaSelected", "Shared file ready")}: {storeInitialData.fileName}</span>
                </p>
              )}

              {/* Batch Import Status & Exact Duplicate Resolution */}
              {batchResult && (
                <div className="mt-3 space-y-2 p-3 bg-muted/40 rounded-xl border border-border" data-testid="batch-status-list">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                    <span>{t("recording.batchResults", "Import Status")}</span>
                    <span className="text-muted-foreground text-[11px]">
                      {batchResult.successCount} saved, {batchResult.failedCount} failed, {batchResult.duplicateCount} duplicate
                    </span>
                  </div>
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto text-xs">
                    {batchResult.items.map((item, idx) => (
                      <li
                        key={idx}
                        className={cn(
                          "p-2 rounded-lg border text-xs flex flex-col gap-1",
                          item.status === "success" && "border-green-500/30 bg-green-500/5 text-foreground",
                          item.status === "duplicate" && "border-amber-500/30 bg-amber-500/5 text-foreground",
                          item.status === "failed" && "border-destructive/30 bg-destructive/5 text-destructive"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {item.status === "success" && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                            {item.status === "duplicate" && <WarningCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                            {item.status === "failed" && <WarningCircle className="w-4 h-4 text-destructive shrink-0" />}
                            <span className="font-medium truncate">{item.filePath.split("/").pop()}</span>
                          </div>
                          <span className="text-[11px] capitalize font-medium opacity-80 shrink-0">
                            {item.status}
                          </span>
                        </div>

                        {item.status === "duplicate" && (
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20 text-[11px]">
                            <span className="text-muted-foreground">
                              {t("recording.duplicateDetected", "Exact recording already exists")}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenExisting(item.documentId)}
                                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-foreground font-medium"
                              >
                                {t("recording.openExisting", "Open existing")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCreateSeparate(item.filePath)}
                                className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground font-medium"
                              >
                                {t("recording.createSeparate", "Create separate")}
                              </button>
                            </div>
                          </div>
                        )}

                        {item.status === "failed" && item.error && (
                          <p className="text-[11px] text-destructive/90">{item.error}</p>
                        )}
                      </li>
                    ))}
                  </ul>

                  {batchResult.failedCount > 0 && (
                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleRetryFailed}
                        disabled={isStarting}
                        className="px-3 py-1 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20"
                      >
                        {t("recording.retryFailed", "Retry failed")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeRoute === "import-transcript" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("recording.transcriptFile", "Transcript file")}
              </label>
              <input
                type="file"
                accept=".srt,.vtt,.txt,text/plain"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("recording.studyWithoutAudio", "You can study a transcript without audio.")}
              </p>
              {storeInitialData?.fileName && !selectedFile && (
                <p className="mt-1 text-xs text-primary flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t("recording.sharedTranscriptSelected", "Shared transcript ready")}: {storeInitialData.fileName}</span>
                </p>
              )}
            </div>
          )}

          {activeRoute === "import-url" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("recording.urlLabel", "Media or transcript URL")}
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {urlDecision && !urlDecision.isAllowed && (
                <div className="mt-1.5 text-xs text-destructive flex items-center gap-1.5 p-2 bg-destructive/10 rounded-lg border border-destructive/20" role="alert">
                  <WarningCircle className="w-4 h-4 shrink-0" />
                  <span>{urlDecision.reason}</span>
                </div>
              )}
              {urlDecision && urlDecision.isAllowed && (
                <div className="mt-1.5 text-xs text-primary flex items-center gap-1.5 p-2 bg-primary/10 rounded-lg border border-primary/20">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {urlDecision.adapter === "youtube" && "YouTube detected: Ingesting canonical transcript and player reference (no raw media download)."}
                    {urlDecision.adapter === "podcast" && "Podcast detected: Ingesting podcast feed and episode stream."}
                    {urlDecision.adapter === "direct-media" && `Direct media stream detected (${urlDecision.meta?.format?.toUpperCase() || "Audio/Video"}).`}
                    {urlDecision.adapter === "direct-transcript" && `Direct transcript file detected (${urlDecision.meta?.format?.toUpperCase()}).`}
                    {urlDecision.adapter === "web-article" && "Web article detected: Reader extraction (article text only)."}
                  </span>
                </div>
              )}
              {!urlDecision && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    "recording.urlHelper",
                    "Supported sources: YouTube, podcasts, direct media links."
                  )}
                </p>
              )}
            </div>
          )}

          {/* Collapsible Processing Section */}
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setProcessingExpanded(!processingExpanded)}
              className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1"
            >
              <span>{t("recording.processingOptions", "Processing options")}</span>
              {processingExpanded ? <CaretDown className="w-3.5 h-3.5" /> : <CaretRight className="w-3.5 h-3.5" />}
            </button>
            {processingExpanded && (
              <div className="mt-2 space-y-2 pt-1 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>{t("recording.configuredProcessor", "Transcription processor")}</span>
                  <span className="font-medium text-foreground">{configuredProvider}</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transcribeWhenReady}
                    onChange={(e) => setTranscribeWhenReady(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>{t("recording.transcribeWhenReady", "Transcribe when ready")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prepareStudySuggestions}
                    onChange={(e) => setPrepareStudySuggestions(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>{t("recording.prepareStudySuggestions", "Prepare study suggestions")}</span>
                </label>
                {contentType === "meeting" && (
                  <p className="text-[11px] text-muted-foreground/80 italic">
                    {t("recording.meetingNotice", "Meeting cards remain off even when meeting analysis is selected.")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Error message / Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <WarningCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            {activeRoute === "record" && (
              <button
                type="button"
                onClick={handleStartRecord}
                className="underline font-medium text-xs hover:opacity-80 shrink-0"
              >
                {t("common.retry", "Retry")}
              </button>
            )}
          </div>
        )}

        {/* Dialog Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors min-h-[44px]"
          >
            {batchResult ? t("common.done", "Done") : t("common.cancel", "Cancel")}
          </button>
          <button
            type="submit"
            disabled={isStarting}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px] flex items-center gap-2"
          >
            {activeRoute === "record" ? (
              <>
                <Microphone className="w-4 h-4" />
                <span>{isStarting ? t("recording.preparing", "Preparing…") : t("recording.startRecording", "Start Recording")}</span>
              </>
            ) : (
              <span>{isStarting ? t("recording.importing", "Importing…") : t("recording.continueImport", "Import")}</span>
            )}
          </button>
        </div>
      </form>
    </ResponsiveDialogSheet>
  );
}

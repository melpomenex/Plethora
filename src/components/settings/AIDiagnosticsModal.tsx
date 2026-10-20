import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ArrowsClockwise, Cpu, Sparkle, Download, Stop } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import {
  clearAllDiagnostics,
  getFeatureSummaries,
  getTaskDiagnostics,
  type FeatureOperationalSummary,
  type OnDeviceTaskDiagnostic,
} from "../../lib/ai/diagnostics";
import {
  buildRedactedDiagnosticsReport,
  serializeRedactedDiagnosticsReport,
  type PlatformFamily,
} from "../../lib/ai/diagnostics/featureReport";
import {
  cancelActiveFeatureSmoke,
  clearFeatureSmokeRecords,
  getFeatureSmokeRecords,
  isFeatureSmokeRunning,
  runFeatureSmoke,
  type FeatureSmokeRecord,
} from "../../lib/ai/diagnostics/featureSmoke";
import { registerDefaultFeatureSmokeAdapters } from "../../lib/ai/diagnostics/smokeAdapters";
import {
  FEATURE_METADATA,
  type FeatureId,
  type FeatureReadiness,
  type RecoveryAction,
} from "../../lib/ai/features/types";
import { useFeatureReadiness } from "../../lib/ai/features/useFeatureReadiness";
import { useOptionalSettingsSearchNavigation } from "./search/SettingsSearchNavigation";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";
import { isOnDeviceAiSupportedPlatform, getOnDeviceAiCapabilities, type OnDeviceCapabilitySnapshot } from "../../lib/ai/onDeviceAI";
import { resolveCurrentAppPlatform } from "../../lib/platformCapabilities";
import { isWindowsDesktop } from "../../lib/ai/windows/capabilities";

interface AIDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function platformFamily(): PlatformFamily {
  const platform = resolveCurrentAppPlatform();
  if (platform === "android") return "android";
  if (platform === "ios") return "ios";
  if (platform === "web") return "web";
  if (isWindowsDesktop()) return "windows";
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "")) return "macos";
  return "linux";
}

function formatTime(value?: number): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function statusTone(status: FeatureReadiness["status"]): string {
  switch (status) {
    case "ready":
      return "bg-green-500/15 text-green-600 dark:text-green-400";
    case "error":
      return "bg-red-500/15 text-red-600 dark:text-red-400";
    case "disabled":
    case "unavailable-platform":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  }
}

function EvidenceBadge({ summary }: { summary?: FeatureOperationalSummary }) {
  const { t } = useI18n();
  if (!summary || !summary.lastOutcome) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        {t("aiDiagnostics.notRun")}
      </span>
    );
  }
  const terminalSuccess =
    summary.stages.persistence?.outcome === "success" ||
    summary.stages.navigation?.outcome === "success";
  const label =
    summary.lastOutcome === "success"
      ? terminalSuccess
        ? t("aiDiagnostics.operational")
        : t("aiDiagnostics.partialEvidence")
      : summary.lastOutcome === "cancelled"
        ? t("aiDiagnostics.static")
        : t("aiDiagnostics.dependency");
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
      {label}
    </span>
  );
}

export function AIDiagnosticsModal({ isOpen, onClose }: AIDiagnosticsModalProps) {
  const { t } = useI18n();
  const navigation = useOptionalSettingsSearchNavigation();
  const readiness = useFeatureReadiness();
  const [diagnostics, setDiagnostics] = useState<OnDeviceTaskDiagnostic[]>([]);
  const [snapshot, setSnapshot] = useState<OnDeviceCapabilitySnapshot | null>(null);
  const [featureSummaries, setFeatureSummaries] = useState<FeatureOperationalSummary[]>([]);
  const [smokeRecords, setSmokeRecords] = useState<FeatureSmokeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSmoke, setSelectedSmoke] = useState<FeatureId | "">("");
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTruncated, setReportTruncated] = useState(false);

  const availableSmokeFeatures = useMemo(
    () => smokeRecords.filter((record) => record.state !== "unsupported").map((record) => record.featureId),
    [smokeRecords]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDiagnostics([...getTaskDiagnostics()]);
      setFeatureSummaries([...getFeatureSummaries()]);
      registerDefaultFeatureSmokeAdapters();
      setSmokeRecords([...getFeatureSmokeRecords()]);
      readiness.refresh();
      if (isOnDeviceAiSupportedPlatform()) {
        const snap = await getOnDeviceAiCapabilities();
        setSnapshot(snap);
      }
    } catch (e) {
      console.error("Failed to load AI diagnostics:", e);
    } finally {
      setLoading(false);
    }
  }, [readiness]);

  useEffect(() => {
    if (isOpen) {
      registerDefaultFeatureSmokeAdapters();
      void refresh();
    }
    // Intentionally only on open: opening diagnostics never runs a smoke test.
  }, [isOpen]);

  if (!isOpen) return null;

  const summaryById = new Map(featureSummaries.map((summary) => [summary.featureId, summary]));

  const handleRunSmoke = async () => {
    if (!selectedSmoke) return;
    setSmokeRunning(true);
    try {
      await runFeatureSmoke(selectedSmoke, {
        capabilityRevision: readiness.revision,
        runId: `smoke-${selectedSmoke}-${Date.now()}`,
      });
      setSmokeRecords([...getFeatureSmokeRecords()]);
      setFeatureSummaries([...getFeatureSummaries()]);
    } finally {
      setSmokeRunning(false);
    }
  };

  const handleExportPreview = () => {
    const report = buildRedactedDiagnosticsReport({
      appVersion: __PLETHORA_APP_VERSION__,
      platformFamily: platformFamily(),
      capabilityRevision: readiness.revision,
      taskDiagnostics: getTaskDiagnostics(),
      featureReadiness: readiness.rows,
      featureSummaries: getFeatureSummaries(),
      currentRevision: readiness.revision,
    });
    const serialized = serializeRedactedDiagnosticsReport(report);
    setReportPreview(serialized.json);
    setReportTruncated(serialized.truncated);
  };

  const handleDownload = () => {
    if (!reportPreview) return;
    const blob = new Blob([reportPreview], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `plethora-ai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleRecover = (action: RecoveryAction) => {
    navigation?.revealTarget(action.targetId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-base">
              {t("aiDiagnostics.title")}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("common.refresh")}
            >
              <ArrowsClockwise className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("common.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
          {/* Feature readiness + operational evidence */}
          <SettingsSearchTarget id="ai.diagnostics.features" label={t("aiDiagnostics.features")}>
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                  {t("aiDiagnostics.features")}
                </h4>
                <button
                  onClick={() => {
                    clearAllDiagnostics();
                    clearFeatureSmokeRecords();
                    setDiagnostics([]);
                    setFeatureSummaries([]);
                    setSmokeRecords([]);
                    setReportPreview(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  {t("aiDiagnostics.clearAll")}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                {t("aiDiagnostics.featuresHint")}
              </p>
              <ul className="space-y-2">
                {readiness.rows.map((row) => {
                  const metadata = FEATURE_METADATA[row.featureId];
                  const summary = summaryById.get(row.featureId);
                  const stages = summary
                    ? Object.values(summary.stages).filter(Boolean)
                    : [];
                  const stale =
                    summary?.capabilityRevision !== undefined &&
                    summary.capabilityRevision !== readiness.revision;
                  const blockers = row.dependencies.filter(
                    (dep) => dep.state !== "satisfied" && dep.state !== "degraded"
                  );
                  return (
                    <li
                      key={row.featureId}
                      className="p-2.5 rounded-lg border border-border bg-muted/10"
                      data-diagnostic-feature={row.featureId}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {t(metadata.labelKey)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusTone(row.checking ? "checking" : row.status)}`}>
                            {t(`ai.feature.status.${(row.checking ? "checking" : row.status).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`)}
                          </span>
                          <EvidenceBadge summary={summary} />
                          {stale && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                              {t("aiDiagnostics.stale")}
                            </span>
                          )}
                        </span>
                      </div>
                      {row.provider && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {row.provider.providerClass} · {t(`ai.destination.${row.provider.destination}`)}
                        </p>
                      )}
                      {blockers.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {blockers.map((dep) => t(dep.reasonKey ?? `ai.feature.dependency.${dep.code}`)).join(" · ")}
                        </p>
                      )}
                      {row.limitations.length > 0 && (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          {row.limitations.map((key) => t(key)).join(" · ")}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{t("aiDiagnostics.lastSuccess")}: {formatTime(summary?.lastSuccessAt)}</span>
                        <span>
                          {t("aiDiagnostics.lastError")}: {formatTime(summary?.lastErrorAt)}
                          {summary?.lastErrorCategory ? ` (${summary.lastErrorCategory})` : ""}
                        </span>
                        {stages.length > 0 && (
                          <span>
                            {t("aiDiagnostics.stages")}:{" "}
                            {stages.map((stage) => `${stage!.stage}=${stage!.outcome}`).join(", ")}
                          </span>
                        )}
                      </div>
                      {row.recoveryActions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {row.recoveryActions.slice(0, 3).map((action) => (
                            <button
                              key={action.targetId}
                              onClick={() => handleRecover(action)}
                              className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                            >
                              {t(action.labelKey)}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </SettingsSearchTarget>

          {/* Hardware snapshot (existing evidence, explicitly static) */}
          <div>
            <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {t("aiDiagnostics.hardwareCapabilities")}
            </h4>
            <p className="text-[11px] text-muted-foreground mb-3">
              {t("aiDiagnostics.static")} — {t("aiDiagnostics.compiled")} is not execution evidence.
            </p>
            {snapshot ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 bg-muted/20 border border-border rounded-lg flex items-center justify-between">
                  <span className="text-foreground text-xs font-medium">Gemini Nano (Prompt)</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    snapshot.prompt.status === "available" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-amber-500/15 text-amber-600"
                  }`}>
                    {snapshot.prompt.status}
                  </span>
                </div>
                <div className="p-3 bg-muted/20 border border-border rounded-lg flex items-center justify-between">
                  <span className="text-foreground text-xs font-medium">ML Kit OCR Text Recognition</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    snapshot.ocr ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {snapshot.ocr ? t("aiDiagnostics.active") : t("aiDiagnostics.unavailable")}
                  </span>
                </div>
                <div className="p-3 bg-muted/20 border border-border rounded-lg flex items-center justify-between">
                  <span className="text-foreground text-xs font-medium">LiteRT EmbeddingGemma</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    snapshot.embeddings ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {snapshot.embeddings ? t("aiDiagnostics.ready") : t("aiDiagnostics.notDownloaded")}
                  </span>
                </div>
                <div className="p-3 bg-muted/20 border border-border rounded-lg flex items-center justify-between">
                  <span className="text-foreground text-xs font-medium">Structured Output Engine</span>
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-muted text-muted-foreground">
                    {t("aiDiagnostics.static")}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-muted/20 border border-border rounded-lg text-xs text-muted-foreground">
                {isOnDeviceAiSupportedPlatform()
                  ? t("aiDiagnostics.querying")
                  : t("aiDiagnostics.desktopEnv")}
              </div>
            )}
          </div>

          {/* Fixture smoke */}
          <SettingsSearchTarget id="ai.diagnostics.smoke" label={t("aiDiagnostics.smoke")}>
            <div>
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {t("aiDiagnostics.smoke")}
              </h4>
              <p className="text-[11px] text-muted-foreground mb-2">
                {t("aiDiagnostics.smokeHint")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedSmoke}
                  onChange={(event) => setSelectedSmoke(event.target.value as FeatureId | "")}
                  className="px-2 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground"
                >
                  <option value="">—</option>
                  {availableSmokeFeatures.map((featureId) => (
                    <option key={featureId} value={featureId}>
                      {t(FEATURE_METADATA[featureId].labelKey)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleRunSmoke()}
                  disabled={!selectedSmoke || smokeRunning || isFeatureSmokeRunning()}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Sparkle className="w-3.5 h-3.5 inline mr-1" />
                  {t("aiDiagnostics.runSmoke")}
                </button>
                <button
                  onClick={() => {
                    cancelActiveFeatureSmoke();
                  }}
                  disabled={!isFeatureSmokeRunning()}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-muted border border-border disabled:opacity-50"
                >
                  <Stop className="w-3.5 h-3.5 inline mr-1" />
                  {t("aiDiagnostics.stopSmoke")}
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {smokeRecords
                  .filter((record) => record.state !== "unsupported")
                  .map((record) => (
                    <li
                      key={record.featureId}
                      className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2"
                      data-smoke-feature={record.featureId}
                      data-smoke-state={record.state}
                    >
                      <span className="font-medium text-foreground">
                        {t(FEATURE_METADATA[record.featureId].labelKey)}
                      </span>
                      <span>{record.state}</span>
                      {record.fixtureId && <span>{record.fixtureId}</span>}
                      {record.durationMs !== undefined && <span>{record.durationMs}ms</span>}
                      {record.unverifiedStages.length > 0 && (
                        <span>
                          {t("aiDiagnostics.stages")}:{" "}
                          {record.unverifiedStages.join(", ")} (unverified)
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          </SettingsSearchTarget>

          {/* Redacted export */}
          <SettingsSearchTarget id="ai.diagnostics.export" label={t("aiDiagnostics.export")}>
            <div>
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {t("aiDiagnostics.export")}
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleExportPreview}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-muted border border-border"
                >
                  {t("aiDiagnostics.exportPreview")}
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!reportPreview}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 inline mr-1" />
                  {t("aiDiagnostics.exportDownload")}
                </button>
              </div>
              {reportPreview ? (
                <div className="mt-2">
                  {reportTruncated && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-1">
                      {t("aiDiagnostics.exportTruncated")}
                    </p>
                  )}
                  <pre className="max-h-48 overflow-auto p-2 bg-muted/20 border border-border rounded-lg text-[10px] leading-relaxed">
                    {reportPreview}
                  </pre>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t("aiDiagnostics.exportEmpty")}
                </p>
              )}
            </div>
          </SettingsSearchTarget>

          {/* Recent task executions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                {t("aiDiagnostics.recentLogs", { count: diagnostics.length })}
              </h4>
            </div>
            {diagnostics.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground bg-muted/10 border border-dashed border-border rounded-lg text-xs">
                {t("aiDiagnostics.noTasks")}
              </div>
            ) : (
              <ul className="space-y-1.5">
                {[...diagnostics].reverse().slice(0, 20).map((entry, index) => (
                  <li
                    key={`${entry.taskId}-${entry.timestamp}-${index}`}
                    className="p-2 bg-muted/10 border border-border rounded-lg text-[11px] text-muted-foreground"
                  >
                    <span className="text-foreground font-medium">{entry.taskId}</span>{" "}
                    · {entry.providerKind ?? "?"} · {entry.modelClass ?? "?"} ·{" "}
                    {entry.totalLatencyMs ?? 0}ms
                    {entry.validationOutcome ? ` · ${entry.validationOutcome}` : ""}
                    {entry.errorCategory ? ` · ${entry.errorCategory}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { X, ArrowsClockwise, Cpu, Sparkle } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { getTaskDiagnostics, clearTaskDiagnostics, type OnDeviceTaskDiagnostic } from "../../lib/ai/diagnostics";
import { getOnDeviceAiCapabilities, type OnDeviceCapabilitySnapshot, isOnDeviceAiSupportedPlatform } from "../../lib/ai/onDeviceAI";

interface AIDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIDiagnosticsModal({ isOpen, onClose }: AIDiagnosticsModalProps) {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = useState<OnDeviceTaskDiagnostic[]>([]);
  const [snapshot, setSnapshot] = useState<OnDeviceCapabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setDiagnostics([...getTaskDiagnostics()]);
      if (isOnDeviceAiSupportedPlatform()) {
        const snap = await getOnDeviceAiCapabilities();
        setSnapshot(snap);
      }
    } catch (e) {
      console.error("Failed to load AI diagnostics:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
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
              onClick={refresh}
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
          {/* Hardware Capability Snapshot */}
          <div>
            <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground mb-3">
              {t("aiDiagnostics.hardwareCapabilities")}
            </h4>
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
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                    {t("aiDiagnostics.compiled")}
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

          {/* Recent Task Executions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                {t("aiDiagnostics.recentLogs", { count: diagnostics.length })}
              </h4>
              {diagnostics.length > 0 && (
                <button
                  onClick={() => {
                    clearTaskDiagnostics();
                    setDiagnostics([]);
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  {t("aiDiagnostics.clearLogs")}
                </button>
              )}
            </div>

            {diagnostics.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/10 border border-dashed border-border rounded-lg text-xs">
                {t("aiDiagnostics.noTasks")}
              </div>
            ) : (
              <div className="space-y-2">
                {diagnostics.slice().reverse().map((d, idx) => (
                  <div key={idx} className="p-3 bg-muted/20 border border-border rounded-lg text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkle className="w-3.5 h-3.5 text-primary" />
                        <span className="font-semibold text-foreground">{d.taskId}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded font-mono text-muted-foreground">
                          {d.taskType}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-[11px]">
                        {new Date(d.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{t("aiDiagnostics.provider")}: <strong className="text-foreground">{d.providerKind ?? "ondevice"}</strong></span>
                      {d.modelClass && <span>{t("aiDiagnostics.class")}: <strong className="text-foreground">{d.modelClass}</strong></span>}
                      {d.totalLatencyMs && (
                        <span>{t("aiDiagnostics.latency")}: <strong className="text-foreground">{d.totalLatencyMs}ms</strong></span>
                      )}
                      {d.validationOutcome && (
                        <span>{t("aiDiagnostics.validation")}: <strong className={d.validationOutcome !== "invalid-structured-output" ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                          {d.validationOutcome}
                        </strong></span>
                      )}
                      {d.fallbackPath && (
                        <span className="text-amber-600 dark:text-amber-400">{t("aiDiagnostics.fallback")}: {d.fallbackPath}</span>
                      )}
                      {d.errorCategory && (
                        <span className="text-destructive">{t("aiDiagnostics.error")}: {d.errorCategory}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
          >
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

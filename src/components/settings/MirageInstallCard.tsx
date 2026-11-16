import { useCallback, useEffect, useState } from "react";
import { CheckCircle, CircleNotch, DownloadSimple, Warning } from "@phosphor-icons/react";
import { ensureMirageModel, getMirageStatus, type MirageStatus } from "../../api/vision";
import { SettingsRow } from "./SettingsPage";

/**
 * Settings card for Cactus Compute's Mirage Vision Engine (`mirage.cact`, ~22 MB).
 * Mirrors the Cactus Whistle install UX: shows runtime + weight cache status
 * and provides a one-click download button when `mirage.cact` is not yet cached.
 */
export function MirageInstallCard() {
  const [status, setStatus] = useState<MirageStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getMirageStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleInstall = async () => {
    setDownloading(true);
    setError(null);
    try {
      await ensureMirageModel();
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SettingsRow
      label="Mirage Vision Engine (Local)"
      searchId="ai.mirageVision"
      description="Cactus Compute's ~22 MB 2-bit quantized vision model for offline OCR, polygon occlusion, spatial pairing, and visual search"
    >
      <div className="w-full max-w-md space-y-2">
        {status?.available ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Mirage (22 MB) is cached and ready for local vision inference.
            </span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Warning className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {status?.modelCached
                  ? status.reason || "Mirage weights are cached, but libcactus native library was not found."
                  : "Mirage (22 MB mirage.cact) is not downloaded."}
              </span>
            </div>
            {!status?.modelCached && (
              <button
                type="button"
                data-testid="mirage-download-btn"
                onClick={() => void handleInstall()}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {downloading ? (
                  <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadSimple className="w-3.5 h-3.5" />
                )}
                <span>{downloading ? "Downloading..." : "Download Mirage Model"}</span>
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    </SettingsRow>
  );
}

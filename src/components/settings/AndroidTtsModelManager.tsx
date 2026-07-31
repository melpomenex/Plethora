/**
 * AndroidTtsModelManager — download, install, switch, and remove on-device
 * TTS models (KittenTTS Micro / Kokoro-82M) for the native Android provider.
 *
 * Renders the model catalog with install state, progress, disk usage, and a
 * remove control. Pulls live state from the native plugin via the bridge; the
 * static catalog is the fallback before the plugin resolves.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isAndroidTtsAvailable,
  onDownloadProgress,
  onDownloadState,
  pluginCancelDownload,
  pluginDeleteModel,
  pluginDownloadModel,
  pluginListModels,
  type AndroidTtsModel,
  type DownloadProgressEvent,
  type DownloadStateEvent,
} from "../../api/tts/android/bridge";
import { useI18n } from "../../lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

interface AndroidTtsModelManagerProps {
  /** Called when a model is selected as the active model. */
  onSelectModel?: (modelId: string) => void;
  /** Currently active model id (from settings). */
  activeModelId?: string;
}

export function AndroidTtsModelManager({
  onSelectModel,
  activeModelId,
}: AndroidTtsModelManagerProps) {
  const { t } = useI18n();
  const available = isAndroidTtsAvailable();
  const [models, setModels] = useState<AndroidTtsModel[]>([]);
  const [progress, setProgress] = useState<Record<string, { bytes: number; total: number }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Load the catalog from the plugin and refresh on download-state changes.
  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      const list = await pluginListModels();
      setModels(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models.");
    }
  }, [available]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    (async () => {
      const u1 = await onDownloadProgress((e: DownloadProgressEvent) => {
        setProgress((prev) => ({ ...prev, [e.modelId]: { bytes: e.bytes, total: e.total } }));
      });
      const u2 = await onDownloadState((e: DownloadStateEvent) => {
        if (!e.installing) {
          setProgress((prev) => {
            const next = { ...prev };
            delete next[e.modelId];
            return next;
          });
        }
        if (cancelled) return;
        void refresh();
      });
      if (cancelled) {
        u1();
        u2();
        return;
      }
      unlisteners.push(u1, u2);
    })();
    void refresh();
    return () => {
      cancelled = true;
      for (const u of unlisteners) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, [available, refresh]);

  const handleDownload = useCallback(
    async (modelId: string) => {
      setError(null);
      setBusy((prev) => ({ ...prev, [modelId]: true }));
      try {
        await pluginDownloadModel(modelId);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/cancel/i.test(msg)) setError(msg);
      } finally {
        setBusy((prev) => ({ ...prev, [modelId]: false }));
      }
    },
    [refresh]
  );

  const handleCancel = useCallback(async (modelId: string) => {
    try {
      await pluginCancelDownload(modelId);
    } catch {
      /* ignore */
    }
  }, []);

  const handleDelete = useCallback(
    async (modelId: string) => {
      setError(null);
      setBusy((prev) => ({ ...prev, [modelId]: true }));
      try {
        await pluginDeleteModel(modelId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove model.");
      } finally {
        setBusy((prev) => ({ ...prev, [modelId]: false }));
      }
    },
    [refresh]
  );

  if (!available) {
    return <p className="text-xs text-muted-foreground">{t("settings.ttsAndroidDesktopNotice")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("settings.ttsAndroidDescription")}</p>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="space-y-2">
        {models.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("settings.ttsAndroidLoadingModels")}</p>
        )}
        {models.map((model) => {
          const prog = progress[model.id];
          const pct = prog && prog.total > 0 ? Math.round((prog.bytes / prog.total) * 100) : 0;
          const isActive = activeModelId === model.id;
          const isBusy = busy[model.id] || model.installing;
          return (
            <div
              key={model.id}
              className={
                "rounded-lg border p-3 text-sm " +
                (isActive ? "border-primary bg-primary/5" : "border-border")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-medium">
                    {model.name}
                    {model.default && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {t("settings.ttsAndroidDefaultBadge")}
                      </span>
                    )}
                    {isActive && (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                        {t("settings.ttsAndroidActiveBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{model.description}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {model.installed
                      ? t("settings.ttsAndroidInstalledSize", {
                          size: formatBytes(model.bytesOnDisk),
                        })
                      : t("settings.ttsAndroidDownloadSize", {
                          size: formatBytes(model.downloadBytes),
                        })}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {model.installed ? (
                    <>
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => onSelectModel?.(model.id)}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          {t("settings.ttsAndroidUse")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDelete(model.id)}
                        className="rounded border border-border px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {t("settings.ttsAndroidRemove")}
                      </button>
                    </>
                  ) : prog ? (
                    <button
                      type="button"
                      onClick={() => void handleCancel(model.id)}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      {t("settings.ttsAndroidCancel")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDownload(model.id)}
                      className="rounded border border-primary bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {t("settings.ttsAndroidDownload")}
                    </button>
                  )}
                </div>
              </div>
              {prog && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {pct}% · {formatBytes(prog.bytes)} / {formatBytes(prog.total)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AndroidTtsModelManager;

/**
 * ChatterboxModelManager — status monitoring, hardware backend display,
 * model weight provisioning, and lifecycle controls for local Chatterbox TTS.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/tauri";
import { CircleNotch, Download, Play, Stop, Trash, Check, WarningCircle } from "@phosphor-icons/react";

export interface ChatterboxStatus {
  running: boolean;
  port: number | null;
  baseUrl: string | null;
  backend: string;
  modelsReady: boolean;
  downloadInProgress: boolean;
  error: string | null;
}

interface DownloadProgressPayload {
  phase: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
}

export function ChatterboxModelManager() {
  const [status, setStatus] = useState<ChatterboxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const res = await invoke<ChatterboxStatus>("chatterbox_status");
      setStatus(res);
      if (!res.downloadInProgress) {
        setDownloadProgress(null);
      }
    } catch (e) {
      console.warn("Failed fetching chatterbox status:", e);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(fetchStatus, 4000);

    let unlistenProg: (() => void) | undefined;
    let unlistenFin: (() => void) | undefined;

    if (isTauri()) {
      void listen<DownloadProgressPayload>("chatterbox://download-progress", (evt) => {
        setDownloadProgress(evt.payload);
      }).then((un) => {
        unlistenProg = un;
      });

      void listen("chatterbox://download-finished", () => {
        setDownloadProgress(null);
        void fetchStatus();
      }).then((un) => {
        unlistenFin = un;
      });
    }

    return () => {
      clearInterval(interval);
      unlistenProg?.();
      unlistenFin?.();
    };
  }, [fetchStatus]);

  const handleStart = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await invoke<ChatterboxStatus>("chatterbox_start");
      setStatus(res);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await invoke<ChatterboxStatus>("chatterbox_stop");
      setStatus(res);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setErrorMsg(null);
    try {
      await invoke("chatterbox_download_model");
      setDownloadProgress({
        phase: "Initializing download...",
        bytesDownloaded: 0,
        totalBytes: 1100000000,
        percentage: 0,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancelDownload = async () => {
    try {
      await invoke("chatterbox_cancel_download");
      setDownloadProgress(null);
    } catch (e) {
      console.warn("Cancel download error:", e);
    }
  };

  const handleDeleteModel = async () => {
    if (!window.confirm("Remove local Chatterbox model weights from disk (~1.1 GB)?")) return;
    try {
      await invoke("chatterbox_delete_model");
      void fetchStatus();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (!isTauri()) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-muted-foreground">
        Local daemon lifecycle management is available when running Plethora Desktop. On Web/PWA, connect to any running OpenAI-compatible local server.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-medium text-foreground">Chatterbox Local TTS Daemon</h4>
          <p className="text-xs text-muted-foreground">
            Zero-cloud-dependency neural TTS with zero-shot voice cloning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status?.running ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Running (Port {status.port})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Stopped
            </span>
          )}
          {status?.backend && (
            <span className="rounded-md border border-border px-2 py-0.5 text-xs uppercase font-mono text-muted-foreground">
              {status.backend}
            </span>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <WarningCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Model Weights State */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 p-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Model Weights (~1.1 GB)</span>
            {status?.modelsReady ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                <Check size={14} /> Ready
              </span>
            ) : (
              <span className="text-xs text-amber-500">Not Downloaded</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Chatterbox ~0.5B neural weights and speaker conditioning vocoder.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {downloadProgress ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {downloadProgress.phase} ({Math.round(downloadProgress.percentage)}%)
              </span>
              <button
                onClick={handleCancelDownload}
                className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          ) : status?.modelsReady ? (
            <button
              onClick={handleDeleteModel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash size={14} /> Remove Weights
            </button>
          ) : (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download size={14} /> Download Weights
            </button>
          )}
        </div>
      </div>

      {downloadProgress && (
        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-primary h-1.5 transition-all duration-200"
            style={{ width: `${downloadProgress.percentage}%` }}
          />
        </div>
      )}

      {/* Lifecycle Actions */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted-foreground">
          {status?.baseUrl ? `Endpoint: ${status.baseUrl}/v1` : "Auto-starts on playback"}
        </span>
        <div className="flex items-center gap-2">
          {status?.running ? (
            <button
              onClick={handleStop}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {loading ? <CircleNotch size={14} className="animate-spin" /> : <Stop size={14} />}
              Stop Daemon
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {loading ? <CircleNotch size={14} className="animate-spin" /> : <Play size={14} />}
              Start Daemon
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

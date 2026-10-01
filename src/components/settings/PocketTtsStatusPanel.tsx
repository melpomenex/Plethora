/**
 * Pocket TTS runtime status, install controls, and install progress.
 *
 * Owns its own status polling and install-event subscription: the install runs
 * detached on the Rust side, so the only source of progress is the
 * `pocket-tts://install-progress` / `pocket-tts://install-finished` events —
 * the invoke that started it returns an install id and nothing more.
 *
 * Everything here branches on the structural `state` from the backend. Nothing
 * matches on substrings of an error message, and no percentage is invented:
 * `percent` comes from a progress event or it is not shown.
 */

import { useCallback, useEffect, useState } from "react";
import { Download, Trash, WifiHigh, WifiSlash } from "@phosphor-icons/react";
import {
  POCKET_TTS_PHASE_SHARE,
  PocketTTSInstallRefusedError,
  cancelPocketTTSInstall,
  checkPocketTTSAvailable,
  installPocketTTS,
  onPocketTTSInstallFinished,
  onPocketTTSInstallProgress,
  uninstallPocketTTS,
  type PocketTTSInstallProgress,
  type PocketTTSStatus,
} from "../../api/pocketTts";
import { isTauri } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";

/** Byte counts on the install progress line, e.g. `312 MB`. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

export function PocketTtsStatusPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<PocketTTSStatus>({ state: "notInstalled" });
  const [install, setInstall] = useState<PocketTTSInstallProgress | null>(null);
  // `hint` is the localized recovery step; `detail` is the backend's own
  // message, which carries the numbers a disk refusal needs. Both are shown —
  // the hint alone would hide "1.0 GB available" behind "free up space".
  const [failure, setFailure] = useState<{ hint: string; detail?: string } | null>(null);

  const refresh = useCallback(() => {
    if (!isTauri()) {
      setStatus({ state: "notInstalled" });
      return;
    }
    void checkPocketTTSAvailable().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    // `listen` resolves asynchronously, so an unmount can land before the
    // unlisten fn exists — hence `disposed`.
    const register = (subscribe: Promise<() => void>) => {
      void subscribe
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => {
          /* no event channel available; the panel still works without it */
        });
    };

    register(
      onPocketTTSInstallProgress((progress) => {
        if (!disposed) setInstall(progress);
      })
    );
    register(
      onPocketTTSInstallFinished((finished) => {
        if (disposed) return;
        setInstall(null);
        // A cancellation is reported through the terminal event rather than as
        // a failure the user has to interpret, so it clears the bar without
        // painting an error.
        if (!finished.ok && !finished.cancelled) {
          setFailure({
            hint: t("settings.ttsPocketInstallFailed"),
            detail: finished.message,
          });
        }
        refresh();
      })
    );

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
    // `t` is deliberately not a dependency: re-subscribing whenever the
    // translation function identity changes would tear down and re-register
    // both listeners mid-install, dropping progress events. The label is read
    // fresh at render time by the JSX below, so a locale switch still updates.
  }, [refresh]);

  const handleInstall = async () => {
    if (!isTauri()) return;
    setFailure(null);
    setStatus((prev) => ({ ...prev, state: "installing", error: null }));
    try {
      await installPocketTTS();
    } catch (error) {
      // Preflight refusals (no Python, not enough disk) and the
      // already-running rejection all arrive with a reason *code*, so the hint
      // is localized rather than matched out of the message.
      if (error instanceof PocketTTSInstallRefusedError) {
        setFailure({
          hint: t(`settings.ttsPocketInstallRefused.${error.reason}`),
          detail: error.message,
        });
      } else {
        setFailure({
          hint: error instanceof Error ? error.message : t("settings.ttsFailedInitPocketTts"),
        });
      }
      setInstall(null);
      refresh();
    }
  };

  const reportError = (error: unknown) => {
    setFailure({
      hint: error instanceof Error ? error.message : t("settings.ttsFailedInitPocketTts"),
    });
  };

  const handleCancel = async () => {
    try {
      await cancelPocketTTSInstall();
    } catch (error) {
      reportError(error);
    }
  };

  const handleRemove = async () => {
    try {
      await uninstallPocketTTS();
      setFailure(null);
    } catch (error) {
      reportError(error);
    }
    refresh();
  };

  const installing = status.state === "installing";
  const installed = status.state === "installed" || installing;
  // Only the copy this app provisioned can be removed — a `pocket-tts` the
  // user installed themselves is not ours to delete.
  const provisioned = status.source === "provisioned";

  // The backend reports progress *within* a phase, so the single bar is
  // composed here from the phase's share of the whole install. An unknown
  // total reports `percent: 0`, rendered as indeterminate rather than as a bar
  // stuck at the phase floor.
  const [phaseLow, phaseHigh] = phaseShare(install?.phase);
  const overallPercent = install
    ? Math.min(100, phaseLow + (install.percent / 100) * (phaseHigh - phaseLow))
    : 0;
  const phaseLabel = t(`settings.ttsPocketPhase.${install?.phase ?? "environment-prep"}`);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {installed ? (
            <WifiSlash className="h-4 w-4 text-green-600" />
          ) : (
            <WifiHigh className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">
            {installing
              ? t("settings.ttsPocketInstalling")
              : status.state === "broken"
                ? t("settings.ttsPocketBroken")
                : status.state === "installed"
                  ? t("settings.ttsPocketReady")
                  : t("settings.ttsPocketNotInstalled")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {installing ? (
            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground"
            >
              {t("settings.ttsPocketCancelInstall")}
            </button>
          ) : (
            <>
              {provisioned && (
                <button
                  onClick={handleRemove}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive"
                >
                  <Trash className="h-4 w-4" />
                  {t("settings.ttsPocketRemove")}
                </button>
              )}
              {status.state !== "installed" && (
                <button
                  onClick={handleInstall}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  <Download className="h-4 w-4" />
                  {status.state === "broken"
                    ? t("settings.ttsPocketReinstall")
                    : t("settings.ttsDownload")}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {installing && install && (
        <div className="mt-3" data-testid="pocket-tts-install-progress">
          {install.total > 0 ? (
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${overallPercent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {phaseLabel} —{" "}
                {t("settings.ttsPocketProgressBytes", {
                  received: formatBytes(install.received),
                  total: formatBytes(install.total),
                })}
              </p>
            </>
          ) : (
            <>
              {/* The total is unknown until the installer announces a size, so
                  the bar is indeterminate rather than a made-up number. */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-pulse bg-primary" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{phaseLabel}</p>
            </>
          )}
        </div>
      )}

      {status.executable && (
        <p className="mt-2 break-all text-xs text-muted-foreground">{status.executable}</p>
      )}

      {(failure || status.error) && (
        <div className="mt-2" data-testid="pocket-tts-error">
          <p className="text-xs text-destructive">{failure?.hint ?? status.error}</p>
          {failure?.detail && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}

      {/* The CLI's own stderr, verbatim: for a broken runtime this is the
          import error that explains *why* it does not load. */}
      {status.detail && (
        <p className="mt-1 break-words text-xs text-muted-foreground">{status.detail}</p>
      )}

      <p className="mt-2 text-xs text-muted-foreground">{t("settings.ttsPocketOfflineNote")}</p>
    </div>
  );
}

/** Phase share, defaulting to the first phase for the pre-first-event case. */
function phaseShare(
  phase: PocketTTSInstallProgress["phase"] | undefined
): [number, number] {
  return POCKET_TTS_PHASE_SHARE[phase ?? "environment-prep"] ?? [0, 5];
}

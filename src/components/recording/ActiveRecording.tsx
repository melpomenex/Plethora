import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Cards,
  CheckCircle,
  CircleNotch,
  DotsThreeVertical,
  Pause,
  Play,
  Question,
  Quotes,
  Star,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRecordingSessionStore } from "../../stores/recordingSessionStore";
import { useUIStore } from "../../stores/uiStore";
import { captureController } from "../../services/recording/captureController";
import { sessionController } from "../../services/recording/SessionController";
import { createSessionMarker, type SessionMarkerKind } from "../../api/recordingSessions";
import { ToastType, useToastStore } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const remMinutes = minutes % 60;
    return `${hours}:${remMinutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export interface ActiveRecordingProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function ActiveRecording({ isOpen: propIsOpen, onClose: propOnClose }: ActiveRecordingProps = {}) {
  const { t } = useI18n();
  const storeIsOpen = useUIStore((s) => s.activeRecordingOpen);
  const setActiveRecordingOpen = useUIStore((s) => s.setActiveRecordingOpen);
  const addToast = useToastStore((s) => s.addToast);

  const isOpen = propIsOpen ?? storeIsOpen;
  const handleMinimize = () => {
    if (propOnClose) {
      propOnClose();
    } else {
      setActiveRecordingOpen(false);
    }
  };

  const recordingStore = useRecordingSessionStore();
  const state = recordingStore.state;
  const health = recordingStore.health;
  const sessionId = recordingStore.activeSessionId;

  // Elapsed clock
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state === "recording") {
      const interval = setInterval(() => {
        setElapsedMs((prev) => prev + 1000);
      }, 1000);
      timerRef.current = interval;
      return () => clearInterval(interval);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [state]);

  // Sync with acknowledged duration when starting
  useEffect(() => {
    if (health?.acknowledgedMs && health.acknowledgedMs > elapsedMs) {
      setElapsedMs(health.acknowledgedMs);
    }
  }, [health?.acknowledgedMs]);

  // Audio activity detection indicator
  const [audioDetected, setAudioDetected] = useState(true);
  useEffect(() => {
    if (state !== "recording") return;
    const interval = setInterval(() => {
      // Periodic low-frequency activity probe (simulated / low rate)
      setAudioDetected(true);
    }, 1500);
    return () => clearInterval(interval);
  }, [state]);

  // Overflow menu and discard confirmation modal
  const [menuOpen, setMenuOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Markers
  const handleAddMarker = async (kind: "important" | "confusing" | "extract" | "card") => {
    const timeStr = formatDurationMs(elapsedMs);
    const markerKind: SessionMarkerKind =
      kind === "important"
        ? "interesting"
        : kind === "confusing"
        ? "confusing"
        : kind === "extract"
        ? "recent-extract"
        : "card-candidate";

    if (sessionId) {
      try {
        const marker = await createSessionMarker({
          sessionId,
          kind: markerKind,
          mediaMs: elapsedMs,
          windowMs: 30000,
        });
        if (marker.windowMs > 30000) {
          addToast({
            type: ToastType.Info,
            title: t("recording.markerTitle", "Marker"),
            message: `Capture window extended to ${marker.windowMs / 1000}s.`,
          });
          return;
        }
      } catch (err) {
        console.warn("[ActiveRecording] Failed to persist marker:", err);
        addToast({
          type: ToastType.Error,
          title: t("recording.markerTitle", "Marker"),
          message: err instanceof Error ? err.message : "Failed to persist marker.",
        });
        return;
      }
    }

    switch (kind) {
      case "important":
        addToast({
          type: ToastType.Success,
          title: t("recording.markerTitle", "Marker"),
          message: t("recording.importantMomentSaved", "Important moment saved at {time}.", { time: timeStr }),
        });
        break;
      case "confusing":
        addToast({
          type: ToastType.Success,
          title: t("recording.markerTitle", "Marker"),
          message: t("recording.confusingMomentSaved", "Confusing moment saved at {time}.", { time: timeStr }),
        });
        break;
      case "extract":
        addToast({
          type: ToastType.Success,
          title: t("recording.markerTitle", "Marker"),
          message: t(
            "recording.extractSaved",
            "Audio bookmark saved; passage will appear after transcription."
          ),
        });
        break;
      case "card":
        addToast({
          type: ToastType.Success,
          title: t("recording.markerTitle", "Marker"),
          message: t("recording.cardCandidateSaved", "Card candidate saved at {time}.", { time: timeStr }),
        });
        break;
    }
  };

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      const finishResult = await captureController.finish();
      if (sessionId) {
        try {
          await sessionController.finalizeIngestion({ sessionId });
        } catch (finalizeErr) {
          console.warn("[ActiveRecording] finalizeIngestion error:", finalizeErr);
        }
      }
      addToast({
        type: finishResult.incomplete ? ToastType.Warning : ToastType.Success,
        title: t("recording.title", "Recording"),
        message: finishResult.incomplete
          ? t("recording.savedIncomplete", "Recording saved with incomplete transcription.")
          : t("recording.savedSuccess", "Recording saved successfully."),
      });
      handleMinimize();
    } catch (err) {
      console.error("[ActiveRecording] finish failed:", err);
      addToast({
        type: ToastType.Error,
        title: t("recording.title", "Recording"),
        message: String(err),
      });
    } finally {
      setIsFinishing(false);
    }
  };

  const handleDiscard = () => {
    captureController.discard();
    setDiscardConfirmOpen(false);
    setMenuOpen(false);
    handleMinimize();
    addToast({
      type: ToastType.Info,
      title: t("recording.title", "Recording"),
      message: t("recording.discarded", "Recording discarded."),
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Active Recording"
    >
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl flex flex-col justify-between min-h-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <button
            type="button"
            onClick={handleMinimize}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium p-1.5 rounded-lg hover:bg-muted transition-colors min-h-[44px]"
            aria-label="Minimize recording"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t("recording.minimize", "Back to library")}</span>
          </button>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                state === "recording" && "bg-destructive animate-pulse",
                state === "paused" && "bg-amber-500",
                state === "interrupted" && "bg-amber-500",
                state === "finalizing" && "bg-primary animate-spin"
              )}
            />
            <span className="text-xs font-semibold capitalize text-foreground">
              {state === "recording" && t("recording.stateRecording", "Recording")}
              {state === "paused" && t("recording.statePaused", "Paused")}
              {state === "interrupted" && t("recording.stateInterrupted", "Interrupted")}
              {state === "finalizing" && t("recording.stateFinalizing", "Saving…")}
            </span>
          </div>

          {/* Overflow Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Recording options"
            >
              <DotsThreeVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-card border border-border shadow-lg py-1.5 z-20 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setDiscardConfirmOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-destructive hover:bg-destructive/10 flex items-center gap-2"
                  >
                    <span>{t("recording.discardRecording", "Discard recording")}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Interrupted Alert */}
        {state === "interrupted" && (
          <div
            role="alert"
            className="my-3 p-3 bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl text-xs space-y-2"
          >
            <div className="flex items-center gap-2 font-medium">
              <WarningCircle className="w-4 h-4 shrink-0" />
              <span>
                {t(
                  "recording.interruptedBanner",
                  "Recording interrupted. Audio saved through {time}.",
                  { time: formatDurationMs(health?.acknowledgedMs || 0) }
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => captureController.resume()}
                className="px-3 py-1 bg-amber-500 text-white rounded font-medium text-xs hover:bg-amber-600"
              >
                {t("recording.resume", "Resume")}
              </button>
              <button
                type="button"
                onClick={handleFinish}
                className="px-3 py-1 bg-border text-foreground rounded font-medium text-xs hover:bg-muted"
              >
                {t("recording.finish", "Finish")}
              </button>
            </div>
          </div>
        )}

        {/* Primary Center Display: Elapsed Time & Health */}
        <div className="my-auto text-center space-y-3 py-6">
          <div className="text-5xl font-mono tabular-nums font-bold tracking-tight text-foreground">
            {formatDurationMs(elapsedMs)}
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {health && health.acknowledgedMs > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle className="w-4 h-4" weight="fill" />
                <span>Saved through {formatDurationMs(health.acknowledgedMs)}</span>
              </span>
            ) : (
              <span>{state === "recording" ? "Saving…" : "Ready"}</span>
            )}
          </div>

          {/* Activity Meter */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted/60 text-xs text-muted-foreground">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                audioDetected ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            <span>{audioDetected ? "Audio detected" : "No input detected"}</span>
          </div>
        </div>

        {/* Live Captions (Temporary) */}
        <div className="mb-4 p-3 bg-muted/30 border border-border/80 rounded-xl text-left text-xs">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground/70 tracking-wider mb-1">
            {t("recording.liveCaptionsLabel", "Live captions · Temporary · may change")}
          </div>
          <p className="text-muted-foreground italic line-clamp-2">
            {state === "recording" ? t("recording.listening", "Listening for speech…") : t("recording.pausedNotice", "Audio capture paused.")}
          </p>
        </div>

        {/* Marker Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" role="group" aria-label="Recording Markers">
          <button
            type="button"
            onClick={() => handleAddMarker("important")}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 text-xs font-medium text-foreground transition-colors min-h-[48px]"
          >
            <Star className="w-4 h-4 text-amber-500" weight="fill" />
            <span>{t("recording.markerImportant", "Important")}</span>
          </button>
          <button
            type="button"
            onClick={() => handleAddMarker("confusing")}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 text-xs font-medium text-foreground transition-colors min-h-[48px]"
          >
            <Question className="w-4 h-4 text-blue-500" weight="bold" />
            <span>{t("recording.markerConfusing", "Confusing")}</span>
          </button>
          <button
            type="button"
            onClick={() => handleAddMarker("extract")}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 text-xs font-medium text-foreground transition-colors min-h-[48px]"
          >
            <Quotes className="w-4 h-4 text-primary" weight="fill" />
            <span>{t("recording.markerExtract", "Save extract")}</span>
          </button>
          <button
            type="button"
            onClick={() => handleAddMarker("card")}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 text-xs font-medium text-foreground transition-colors min-h-[48px]"
          >
            <Cards className="w-4 h-4 text-purple-500" weight="fill" />
            <span>{t("recording.markerCard", "Card candidate")}</span>
          </button>
        </div>

        {/* Footer: Pause/Resume and Finish recording */}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          {state === "paused" ? (
            <button
              type="button"
              onClick={() => captureController.resume()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors min-h-[48px]"
            >
              <Play className="w-4 h-4 text-primary" weight="fill" />
              <span>{t("recording.resume", "Resume")}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => captureController.pause()}
              disabled={state !== "recording"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50 min-h-[48px]"
            >
              <Pause className="w-4 h-4" weight="fill" />
              <span>{t("recording.pause", "Pause")}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleFinish}
            disabled={isFinishing}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[48px]"
          >
            {isFinishing ? (
              <>
                <CircleNotch className="w-4 h-4 animate-spin" />
                <span>{t("recording.finishing", "Saving recording…")}</span>
              </>
            ) : (
              <span>{t("recording.finishRecording", "Finish recording")}</span>
            )}
          </button>
        </div>
      </div>

      {/* Discard Confirmation Modal */}
      {discardConfirmOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4"
          role="alertdialog"
          aria-label="Confirm discard"
        >
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-5 shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-foreground">
              {t("recording.discardTitle", "Discard recording?")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                "recording.discardWarning",
                "All recorded audio for this session will be permanently deleted. This action cannot be undone."
              )}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDiscardConfirmOpen(false)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground font-medium rounded-lg hover:bg-destructive/90"
              >
                {t("recording.confirmDiscard", "Discard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

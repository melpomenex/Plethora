import { useI18n, type TranslateFn } from "../../lib/i18n";
import type { MediaPlaybackFailure, MediaPlaybackPlan, PlaybackStrategy } from "../../lib/media/types";
import type { MediaCompatibilityState } from "../../hooks/useMediaCompatibility";
import { cn } from "../../utils";

interface MediaCompatibilityPanelProps {
  state: MediaCompatibilityState;
  failureMessage?: string;
  onConfirmConsent: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onTryOriginal: () => void;
  onManageCache?: () => void;
  onInstallHelp?: () => void;
}

function consentBody(plan: MediaPlaybackPlan, t: TranslateFn): string {
  if (plan.consentReasons.includes("hdr_tone_mapping")) {
    return t("mediaCompatibility.consent.hdrToneMapping");
  }
  if (plan.strategy === "video_transcode") {
    return t("mediaCompatibility.consent.videoTranscode");
  }
  if (plan.strategy === "audio_transcode") {
    return t("mediaCompatibility.consent.audioTranscode");
  }
  return t("mediaCompatibility.consent.remux");
}

function actionLabel(action: string, t: TranslateFn): string {
  switch (action) {
    case "retry": return t("common.retry");
    case "convert": return t("mediaCompatibility.action.prepareCopy");
    case "try_original": return t("mediaCompatibility.consent.tryOriginal");
    case "reimport": return t("mediaCompatibility.action.reimportVideo");
    case "manage_cache": return t("mediaCompatibility.action.manageCache");
    case "install_help": return t("mediaCompatibility.action.installHelp");
    case "resume": return t("mediaCompatibility.action.resume");
    case "show_details": return t("mediaCompatibility.failure.details");
    default: return t("mediaCompatibility.action.unknown", { var0: action });
  }
}

function strategyLabel(strategy: PlaybackStrategy | undefined, t: TranslateFn): string {
  switch (strategy) {
    case "native": return t("mediaCompatibility.strategy.native");
    case "remux": return t("mediaCompatibility.strategy.remux");
    case "audio_transcode": return t("mediaCompatibility.strategy.audioTranscode");
    case "video_transcode": return t("mediaCompatibility.strategy.videoTranscode");
    case "unavailable": return t("mediaCompatibility.strategy.unavailable");
    default: return t("mediaCompatibility.failure.unknown");
  }
}

export function MediaCompatibilityPanel({
  state,
  failureMessage,
  onConfirmConsent,
  onCancel,
  onRetry,
  onTryOriginal,
  onManageCache,
  onInstallHelp,
}: MediaCompatibilityPanelProps) {
  const { t } = useI18n();

  if (
    state.kind === "idle" ||
    state.kind === "native" ||
    state.kind === "ready" ||
    state.kind === "inspecting"
  ) {
    return null;
  }

  const failure: MediaPlaybackFailure | undefined = state.kind === "failed" ? state.failure : undefined;
  const plan = state.kind === "consent" || state.kind === "preparing" || state.kind === "failed"
    ? state.plan
    : undefined;
  const job = state.kind === "preparing" ? state.job : state.kind === "failed" ? state.job : undefined;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-4" role="alert">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl">
        {state.kind === "preparing" && (
          <>
            <h3 className="text-lg font-semibold">{t("mediaCompatibility.preparing.title", "Preparing this video for playback")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan?.strategy === "audio_transcode"
                ? t("mediaCompatibility.preparing.audio", "Converting an unsupported audio track. The video is kept unchanged.")
                : plan?.strategy === "video_transcode"
                  ? t("mediaCompatibility.preparing.video", "Converting the video to a compatible format. This can take a while.")
                  : t("mediaCompatibility.preparing.remux", "Creating a compatible copy without re-encoding the video or audio.")}
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress.percent ?? undefined}>
              {job?.progress.percent == null ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              ) : (
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${job.progress.percent}%` }} />
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {job?.progress.processedSeconds != null && job.progress.durationSeconds
                ? t("mediaCompatibility.preparing.progressTime", {
                    var0: Math.floor(job.progress.processedSeconds),
                    var1: Math.floor(job.progress.durationSeconds),
                  })
                : t("mediaCompatibility.preparing.background", "You can keep using Plethora while this finishes.")}
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted" onClick={onCancel}>
                {t("mediaCompatibility.preparing.cancel", "Cancel")}
              </button>
            </div>
          </>
        )}

        {state.kind === "consent" && plan && (
          <>
            <h3 className="text-lg font-semibold">{t("mediaCompatibility.consent.title", "Prepare this video for playback?")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{consentBody(plan, t)}</p>
            {plan.estimated?.outputBytesFloor ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("mediaCompatibility.consent.storageAmount", {
                  var0: Math.ceil(plan.estimated.outputBytesFloor / (1024 ** 3)),
                })}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted" onClick={onCancel}>
                {t("mediaCompatibility.consent.cancel", "Cancel")}
              </button>
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted" onClick={onTryOriginal}>
                {t("mediaCompatibility.consent.tryOriginal", "Try original anyway")}
              </button>
              <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90" onClick={onConfirmConsent}>
                {t("mediaCompatibility.consent.convert", "Prepare")}
              </button>
            </div>
          </>
        )}

        {state.kind === "failed" && failure && (
          <>
            <h3 className="text-lg font-semibold">{t("mediaCompatibility.failure.title", "Playback Error")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {failureMessage ?? t(failure.messageKey, failure.code)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{failure.code}</p>
            {failure.actions.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {failure.actions.filter((action) => action !== "show_details").map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm",
                      action === "convert" || action === "retry"
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "border border-border hover:bg-muted",
                    )}
                    onClick={() => {
                      if (action === "retry" || action === "resume") onRetry();
                      else if (action === "convert") onConfirmConsent();
                      else if (action === "try_original") onTryOriginal();
                      else if (action === "manage_cache") onManageCache?.();
                      else if (action === "install_help") onInstallHelp?.();
                    }}
                  >
                    {actionLabel(action, t)}
                  </button>
                ))}
              </div>
            )}
            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">{t("mediaCompatibility.failure.details", "Technical details")}</summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <dt>{t("mediaCompatibility.failure.strategy")}</dt><dd>{strategyLabel(plan?.strategy, t)}</dd>
                <dt>{t("mediaCompatibility.failure.failure")}</dt><dd>{failure.code}</dd>
                <dt>{t("mediaCompatibility.failure.container")}</dt><dd>{state.inspection?.container ?? t("mediaCompatibility.failure.unknown")}</dd>
                <dt>{t("mediaCompatibility.failure.video")}</dt><dd>{state.inspection?.videoStreams.find((stream) => !stream.isAttachedPic)?.codec ?? t("mediaCompatibility.failure.unknown")}</dd>
                <dt>{t("mediaCompatibility.failure.audio")}</dt><dd>{state.inspection?.audioStreams[0]?.codec ?? t("mediaCompatibility.failure.unknown")}</dd>
                <dt>{t("mediaCompatibility.failure.subtitles")}</dt><dd>{state.inspection?.subtitleStreams.length ?? t("mediaCompatibility.failure.none")}</dd>
              </dl>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

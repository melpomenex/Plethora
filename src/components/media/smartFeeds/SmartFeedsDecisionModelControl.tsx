import { useState } from "react";
import { Cpu, Play, SlidersHorizontal, Stop } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import {
  LAYA_PROVIDER_ID,
  LOCAL_DECISION_ENGINE_PROVIDER_ID,
  NO_DECISION_MODEL_ID,
  getDecisionModelOption,
} from "../../../lib/daqe/decisionModelOptions";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useLayaServerStatus } from "../../../hooks/useLayaServerStatus";
import { DecisionModelModal } from "../../queue/DecisionModelModal";
import { cn } from "../../../utils";

export interface SmartFeedsDecisionModelControlProps {
  variant?: "pill" | "icon" | "inline";
  className?: string;
}

/**
 * Quick access to the active decision model (Laya, OpenRouter, Jev, Clef, etc.)
 * from RSS View / Smart Feeds without having to open the Queue's Customize
 * Session modal.
 */
export function SmartFeedsDecisionModelControl({
  variant = "pill",
  className,
}: SmartFeedsDecisionModelControlProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);

  const providerId =
    useSettingsStore((s) => s.settings.daqe?.decisionModelProviderId) ?? NO_DECISION_MODEL_ID;
  const isLaya = providerId === LAYA_PROVIDER_ID;
  const isLocalEngine = providerId === LOCAL_DECISION_ENGINE_PROVIDER_ID;

  const {
    status: layaStatus,
    busy: layaBusy,
    starting: layaStarting,
    error: layaError,
    supported: layaSupported,
    start: startLaya,
    stop: stopLaya,
  } = useLayaServerStatus(isLaya || variant === "inline");

  const option = getDecisionModelOption(providerId);
  const providerLabel = option ? t(option.labelKey) : t("daqeModel.none");
  const layaRunning = Boolean(layaStatus?.running);

  const statusTone = isLaya
    ? layaRunning
      ? "bg-emerald-500"
      : layaStarting
        ? "bg-amber-500 animate-pulse"
        : "bg-muted-foreground/50"
    : providerId !== NO_DECISION_MODEL_ID
      ? "bg-emerald-500"
      : "bg-muted-foreground/40";

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={cn(
            "relative p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors",
            className,
          )}
          title={`${t("daqeModel.title")}: ${providerLabel}`}
          aria-label={t("smartFeeds.configureDecisionModel")}
        >
          <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
          <span
            className={cn("absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full", statusTone)}
            aria-hidden="true"
          />
        </button>
        <DecisionModelModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  if (variant === "inline") {
    return (
      <>
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs",
            className,
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("w-2 h-2 rounded-full shrink-0", statusTone)} aria-hidden="true" />
            <span className="font-medium text-foreground truncate">
              {t("daqeModel.title")}: {providerLabel}
            </span>
            {isLaya && layaSupported && (
              <span className="text-[11px] text-muted-foreground">
                ·{" "}
                {layaRunning
                  ? t("smartFeeds.layaStatusRunning")
                  : layaStarting
                    ? t("daqeDownload.layaStarting")
                    : t("smartFeeds.layaStatusStopped")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {layaSupported && (isLaya || isLocalEngine || providerId === NO_DECISION_MODEL_ID) && (
              layaRunning ? (
                layaStatus?.managed ? (
                  <button
                    type="button"
                    onClick={() => void stopLaya()}
                    disabled={layaBusy}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                  >
                    <Stop className="w-3 h-3" aria-hidden="true" />
                    {t("daqeDownload.stopLaya")}
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  onClick={() => void startLaya({ selectProvider: true })}
                  disabled={layaStarting}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  <Play className="w-3 h-3" weight="fill" aria-hidden="true" />
                  {layaStarting ? t("daqeDownload.layaStarting") : t("smartFeeds.startLayaAction")}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
              {t("smartFeeds.configureDecisionModel")}
            </button>
          </div>
          {layaError && (
            <p className="w-full text-[11px] text-destructive" role="alert">
              {layaError}
            </p>
          )}
        </div>
        <DecisionModelModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  // Default: "pill" variant for SmartFeedsDashboardSection header
  return (
    <>
      <div className={cn("inline-flex items-center gap-1", className)}>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/60 text-xs font-medium text-foreground transition-colors"
          title={t("smartFeeds.configureDecisionModel")}
        >
          <span className={cn("w-2 h-2 rounded-full shrink-0", statusTone)} aria-hidden="true" />
          <Cpu className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-[11rem] truncate">{providerLabel}</span>
          {isLaya && layaSupported && (
            <span className="text-[10px] text-muted-foreground">
              ({layaRunning
                ? t("smartFeeds.layaStatusRunning")
                : layaStarting
                  ? t("daqeDownload.layaStarting")
                  : t("smartFeeds.layaStatusStopped")})
            </span>
          )}
        </button>

        {isLaya && layaSupported && !layaRunning && (
          <button
            type="button"
            onClick={() => void startLaya({ selectProvider: true })}
            disabled={layaStarting}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors disabled:opacity-50"
            title={t("smartFeeds.startLayaAction")}
          >
            <Play className="w-3 h-3" weight="fill" aria-hidden="true" />
            {layaStarting ? t("daqeDownload.layaStarting") : t("smartFeeds.startLayaAction")}
          </button>
        )}

        {isLaya && layaSupported && layaRunning && layaStatus?.managed && (
          <button
            type="button"
            onClick={() => void stopLaya()}
            disabled={layaBusy}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors disabled:opacity-50"
            title={t("daqeDownload.stopLaya")}
            aria-label={t("daqeDownload.stopLaya")}
          >
            <Stop className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
      <DecisionModelModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

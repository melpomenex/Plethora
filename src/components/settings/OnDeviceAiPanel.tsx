/**
 * On-device AI status and controls (Gemini Nano on Android, Apple snapshot on iOS).
 */

import { useCallback, useEffect, useState } from "react";
import { SettingsRow, SettingsSection } from "./SettingsPage";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  downloadOnDeviceEmbeddingModel,
  getOnDeviceEmbeddingStatus,
  isOnDeviceAiAvailable,
  isOnDeviceAiSupportedPlatform,
  requestModelDownload,
  type OnDeviceAiStatus,
  type OnDeviceEmbeddingStatus,
} from "../../lib/ai/onDeviceAI";
import {
  getAppleIntelligenceSnapshot,
  isAppleOsPlatform,
} from "../../lib/ai/apple/capabilities";
import type { AppleIntelligenceSnapshot } from "../../lib/ai/apple/types";
import { OnDeviceProcessingBadge } from "../common/OnDeviceProcessingBadge";
import { ToastType, useToastStore } from "../common/Toast";
import { useI18n } from "../../lib/i18n";

const STATUS_KEY: Record<OnDeviceAiStatus["status"], string> = {
  available: "available",
  downloadable: "downloadable",
  downloading: "downloading",
  unavailable: "unavailable",
};

export function OnDeviceAiPanel({ onChange }: { onChange: () => void }) {
  const { settings, updateSettings } = useSettingsStore();
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useI18n();

  const android = isOnDeviceAiSupportedPlatform();
  const appleOs = isAppleOsPlatform();

  const [status, setStatus] = useState<OnDeviceAiStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<OnDeviceEmbeddingStatus | null>(null);
  const [embedDownloading, setEmbedDownloading] = useState(false);
  const [embedPercent, setEmbedPercent] = useState<number | null>(null);
  const [appleSnap, setAppleSnap] = useState<AppleIntelligenceSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await isOnDeviceAiAvailable());
  }, []);

  const refreshEmbedding = useCallback(async () => {
    setEmbedStatus(await getOnDeviceEmbeddingStatus());
  }, []);

  const refreshApple = useCallback(async () => {
    setAppleSnap(await getAppleIntelligenceSnapshot());
  }, []);

  useEffect(() => {
    if (android) {
      void refresh();
      void refreshEmbedding();
    }
    if (appleOs) {
      void refreshApple();
    }
  }, [android, appleOs, refresh, refreshEmbedding, refreshApple]);

  if (!android && !appleOs) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const next = await requestModelDownload();
      setStatus(next);
      addToast({
        type: next.status === "available" ? ToastType.Success : ToastType.Info,
        title: t("onDeviceAi.downloadTitle"),
        message: t(`onDeviceAi.status.${STATUS_KEY[next.status]}`),
      });
    } catch (error) {
      addToast({
        type: ToastType.Error,
        title: t("onDeviceAi.downloadFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleEmbedDownload = async () => {
    setEmbedDownloading(true);
    setEmbedPercent(null);
    try {
      const next = await downloadOnDeviceEmbeddingModel((progress) => {
        setEmbedPercent(progress.percent >= 0 ? progress.percent : null);
      });
      setEmbedStatus(next);
      addToast({
        type: next.status === "available" ? ToastType.Success : ToastType.Info,
        title: t("onDeviceAi.embeddingLabel"),
        message: t(`onDeviceAi.embeddingDetail.${STATUS_KEY[next.status]}`),
      });
    } catch (error) {
      addToast({
        type: ToastType.Error,
        title: t("onDeviceAi.downloadFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
      void refreshEmbedding();
    } finally {
      setEmbedDownloading(false);
      setEmbedPercent(null);
    }
  };

  const handleToggle = (enabled: boolean) => {
    updateSettings({ ai: { ...settings.ai, preferOnDevice: enabled } });
    onChange();
  };

  const handleFallbackToggle = (enabled: boolean) => {
    updateSettings({ ai: { ...settings.ai, allowCloudFallback: enabled } });
    onChange();
  };

  const embedDetailKey = embedStatus
    ? `onDeviceAi.embeddingDetail.${STATUS_KEY[embedStatus.status]}`
    : "onDeviceAi.checking";
  const embedStatusText = embedStatus
    ? t(`onDeviceAi.status.${STATUS_KEY[embedStatus.status]}`)
    : "…";
  const embedProgressText =
    embedPercent != null && embedDownloading ? ` ${embedPercent}%` : "";

  return (
    <SettingsSection
      title={t("onDeviceAi.sectionTitle")}
      description={t("onDeviceAi.sectionDescription")}
    >
      {android && (
        <>
          <SettingsRow
            label={t("onDeviceAi.statusLabel")}
            description={
              status ? t(`onDeviceAi.detail.${STATUS_KEY[status.status]}`) : t("onDeviceAi.checking")
            }
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {status ? t(`onDeviceAi.status.${STATUS_KEY[status.status]}`) : "…"}
              </span>
              {status?.status === "downloadable" && (
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {downloading ? t("onDeviceAi.downloadInProgress") : t("onDeviceAi.download")}
                </button>
              )}
              {status?.status === "downloading" && (
                <button
                  onClick={() => void refresh()}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  {t("onDeviceAi.refresh")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label={t("onDeviceAi.embeddingLabel")} description={t(embedDetailKey)}>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {embedStatusText}
                {embedProgressText}
              </span>
              {(embedStatus?.status === "downloadable" || embedStatus?.status === "unavailable") &&
                embedStatus?.reason !== "feature_not_compiled" &&
                embedStatus?.reason !== "platform_unsupported" && (
                  <button
                    onClick={handleEmbedDownload}
                    disabled={embedDownloading}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {embedDownloading
                      ? `${t("onDeviceAi.downloadInProgress")}${embedProgressText}`
                      : t("onDeviceAi.download")}
                  </button>
                )}
              {embedStatus?.status === "downloading" && !embedDownloading && (
                <button
                  onClick={() => void refreshEmbedding()}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  {t("onDeviceAi.refresh")}
                </button>
              )}
            </div>
          </SettingsRow>
        </>
      )}

      {appleOs && (
        <>
          <SettingsRow
            label={t("onDeviceAi.appleSectionTitle")}
            description={
              appleSnap?.foundationModels.status === "available"
                ? t("onDeviceAi.appleFoundationLabel")
                : appleSnap
                  ? `${t("onDeviceAi.appleUnavailable")} (${appleSnap.foundationModels.reason ?? appleSnap.foundationReason ?? "unavailable"})`
                  : t("onDeviceAi.checking")
            }
          >
            <OnDeviceProcessingBadge />
          </SettingsRow>
          <SettingsRow
            label={t("onDeviceAi.appleCoreAiTitle")}
            description={
              settings.features.appleCoreAI
                ? t("onDeviceAi.appleCoreAiOn")
                : t("onDeviceAi.appleCoreAiOff")
            }
          >
            <span className="text-sm text-muted-foreground">
              {t("onDeviceAi.appleCoreAiLocal")}
            </span>
          </SettingsRow>
        </>
      )}

      <SettingsRow
        label={t("onDeviceAi.preferLabel")}
        description={t("onDeviceAi.preferDescription")}
      >
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.ai.preferOnDevice !== false}
            onChange={(e) => handleToggle(e.target.checked)}
            aria-label={t("onDeviceAi.preferLabel")}
          />
          <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t("onDeviceAi.allowCloudFallbackLabel")}
        description={t("onDeviceAi.allowCloudFallbackDescription")}
      >
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.ai.allowCloudFallback === true}
            onChange={(e) => handleFallbackToggle(e.target.checked)}
            aria-label={t("onDeviceAi.allowCloudFallbackLabel")}
          />
          <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </SettingsRow>
    </SettingsSection>
  );
}

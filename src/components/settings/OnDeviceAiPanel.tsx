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
  deleteAndroidSttModel,
  getAndroidSttStatus,
  invalidateAndroidSttReadiness,
  listAndroidSttModels,
  prepareAndroidSttModel,
  type AndroidSttModel,
  type AndroidSttStatus,
} from "../../lib/ai/android/androidStt";
import {
  getAppleIntelligenceSnapshot,
  isAppleOsPlatform,
  resetAppleIntelligenceCache,
} from "../../lib/ai/apple/capabilities";
import type { AppleFeatureState } from "../../lib/ai/apple/types";
import { nativePlatform } from "../../lib/tauri";
import { OnDeviceProcessingBadge } from "../common/OnDeviceProcessingBadge";
import { listLicensedModels } from "../../lib/ai/modelLicense";
import { ToastType, useToastStore } from "../common/Toast";
import { useI18n } from "../../lib/i18n";

const STATUS_KEY: Record<OnDeviceAiStatus["status"], string> = {
  available: "available",
  downloadable: "downloadable",
  downloading: "downloading",
  unavailable: "unavailable",
};

const APPLE_FOUNDATION_REASONS = [
  "model_not_ready",
  "device_not_eligible",
  "apple_intelligence_disabled",
  "unsupported_os",
  "platform_unsupported",
] as const;

type AppleFoundationReason = (typeof APPLE_FOUNDATION_REASONS)[number];

function isMacOsPlatform(): boolean {
  const platform = nativePlatform();
  return platform === "macos" || platform === "darwin";
}

function resolveAppleFoundationReason(
  state: AppleFeatureState | undefined,
  foundationReason?: string,
): AppleFoundationReason | "available" | "unknown" {
  if (!state) return "unknown";
  if (state.status === "available") return "available";
  if (state.status === "downloading" || state.reason === "model_not_ready") {
    return "model_not_ready";
  }
  const reason = state.reason ?? foundationReason;
  if (reason && (APPLE_FOUNDATION_REASONS as readonly string[]).includes(reason)) {
    return reason as AppleFoundationReason;
  }
  return "unknown";
}

function appleFoundationStatusKey(
  resolved: ReturnType<typeof resolveAppleFoundationReason>,
): string {
  switch (resolved) {
    case "available":
      return "onDeviceAi.appleFoundationStatus.available";
    case "model_not_ready":
      return "onDeviceAi.status.downloading";
    case "device_not_eligible":
      return "onDeviceAi.appleFoundationStatus.device_not_eligible";
    case "apple_intelligence_disabled":
      return "onDeviceAi.appleFoundationStatus.apple_intelligence_disabled";
    case "unsupported_os":
      return "onDeviceAi.appleFoundationStatus.unsupported_os";
    case "platform_unsupported":
      return "onDeviceAi.appleFoundationStatus.platform_unsupported";
    default:
      return "onDeviceAi.status.unavailable";
  }
}

function appleFoundationDetailKey(
  resolved: ReturnType<typeof resolveAppleFoundationReason>,
): string {
  if (resolved === "unknown") return "onDeviceAi.appleUnavailable";
  return `onDeviceAi.appleFoundationDetail.${resolved}`;
}

export function OnDeviceAiPanel({ onChange }: { onChange: () => void }) {
  const { settings, updateSettings } = useSettingsStore();
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useI18n();

  const android = isOnDeviceAiSupportedPlatform();
  const appleOs = isAppleOsPlatform();
  const macOs = appleOs && isMacOsPlatform();

  const [status, setStatus] = useState<OnDeviceAiStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<OnDeviceEmbeddingStatus | null>(null);
  const [embedDownloading, setEmbedDownloading] = useState(false);
  const [embedPercent, setEmbedPercent] = useState<number | null>(null);
  const [appleSnap, setAppleSnap] = useState<AppleIntelligenceSnapshot | null>(null);
  const [sttStatus, setSttStatus] = useState<AndroidSttStatus | null>(null);
  const [sttModels, setSttModels] = useState<AndroidSttModel[]>([]);
  const [sttDownloadingId, setSttDownloadingId] = useState<string | null>(null);
  const [sttDownloadPercent, setSttDownloadPercent] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await isOnDeviceAiAvailable());
  }, []);

  const refreshStt = useCallback(async () => {
    try {
      const [nextStatus, nextModels] = await Promise.all([
        getAndroidSttStatus(),
        listAndroidSttModels(),
      ]);
      setSttStatus(nextStatus);
      setSttModels(nextModels.models);
    } catch {
      // platform_unsupported or plugin missing — leave previous state.
    }
  }, []);

  const refreshEmbedding = useCallback(async () => {
    setEmbedStatus(await getOnDeviceEmbeddingStatus());
  }, []);

  const refreshApple = useCallback(async () => {
    resetAppleIntelligenceCache();
    setAppleSnap(await getAppleIntelligenceSnapshot());
  }, []);

  useEffect(() => {
    if (android) {
      void refresh();
      void refreshEmbedding();
      void refreshStt();
    }
    if (appleOs) {
      void refreshApple();
    }
  }, [android, appleOs, refresh, refreshEmbedding, refreshApple, refreshStt]);

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

  const handleSttDownload = async (model: AndroidSttModel) => {
    setSttDownloadingId(model.id);
    setSttDownloadPercent(null);
    try {
      await prepareAndroidSttModel(model.id, (progress) => {
        const percent =
          progress.totalBytes > 0
            ? Math.floor((progress.bytes / progress.totalBytes) * 100)
            : null;
        setSttDownloadPercent(percent);
      });
      invalidateAndroidSttReadiness();
      addToast({
        type: ToastType.Success,
        title: t("onDeviceAi.sttLabel"),
        message: t("onDeviceAi.sttReady"),
      });
    } catch (error) {
      addToast({
        type: ToastType.Error,
        title: t("onDeviceAi.downloadFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSttDownloadingId(null);
      setSttDownloadPercent(null);
      void refreshStt();
    }
  };

  const handleSttDelete = async (model: AndroidSttModel) => {
    try {
      await deleteAndroidSttModel(model.id);
      invalidateAndroidSttReadiness();
      addToast({
        type: ToastType.Info,
        title: t("onDeviceAi.sttLabel"),
        message: t("onDeviceAi.sttDeleted"),
      });
    } catch (error) {
      addToast({
        type: ToastType.Error,
        title: t("onDeviceAi.sttLabel"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      void refreshStt();
    }
  };

  const handleSttModelSelect = (modelId: string) => {
    updateSettings({
      audioTranscription: {
        ...settings.audioTranscription,
        androidOnDevice: {
          ...settings.audioTranscription.androidOnDevice,
          modelId,
          pacing: settings.audioTranscription.androidOnDevice?.pacing ?? "capped",
        },
      },
    });
    onChange();
  };

  const handleSttPacing = (pacing: "capped" | "full") => {
    updateSettings({
      audioTranscription: {
        ...settings.audioTranscription,
        androidOnDevice: {
          modelId: settings.audioTranscription.androidOnDevice?.modelId ?? "",
          pacing,
        },
      },
    });
    onChange();
  };

  const handleToggle = (enabled: boolean) => {
    updateSettings({ ai: { ...settings.ai, preferOnDevice: enabled } });
    onChange();
  };

  const handleFallbackToggle = (enabled: boolean) => {
    updateSettings({ ai: { ...settings.ai, allowCloudFallback: enabled } });
    onChange();
  };

  const handleSpeechToggle = (enabled: boolean) => {
    updateSettings({
      audioTranscription: { ...settings.audioTranscription, preferAndroidSpeech: enabled },
    });
    onChange();
  };

  const handleAppSearchToggle = (enabled: boolean) => {
    updateSettings({
      features: { ...settings.features, androidAppSearchIndex: enabled },
    });
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

  const appleFoundationResolved = appleSnap
    ? resolveAppleFoundationReason(appleSnap.foundationModels, appleSnap.foundationReason)
    : "unknown";
  const appleFoundationAvailable = appleFoundationResolved === "available";

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

          {/* On-device speech-to-text (sherpa-onnx): capability + model rows. */}
          <SettingsRow
            label={t("onDeviceAi.sttLabel")}
            description={
              sttStatus
                ? sttStatus.ready
                  ? t("onDeviceAi.sttReadyDescription")
                  : t("onDeviceAi.sttNotReadyDescription")
                : t("onDeviceAi.checking")
            }
          >
            <div className="flex items-center gap-3">
              <OnDeviceProcessingBadge />
            </div>
          </SettingsRow>

          {sttModels.map((model) => (
            <SettingsRow
              key={model.id}
              label={model.name}
              description={`${model.description} · ${Math.round(model.downloadBytes / 1_000_000)} MB`}
            >
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="radio"
                    name="stt-model"
                    checked={
                      settings.audioTranscription.androidOnDevice?.modelId === model.id ||
                      (!settings.audioTranscription.androidOnDevice?.modelId && model.default)
                    }
                    disabled={!model.ready}
                    onChange={() => handleSttModelSelect(model.id)}
                    aria-label={`${t("onDeviceAi.sttSelectModel")}: ${model.name}`}
                  />
                  {model.ready ? t("onDeviceAi.sttModelReady") : t("onDeviceAi.sttModelNotReady")}
                </label>
                {!model.ready && (
                  <button
                    onClick={() => void handleSttDownload(model)}
                    disabled={sttDownloadingId !== null}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {sttDownloadingId === model.id
                      ? sttDownloadPercent != null
                        ? `${t("onDeviceAi.downloadInProgress")} ${sttDownloadPercent}%`
                        : t("onDeviceAi.downloadInProgress")
                      : t("onDeviceAi.download")}
                  </button>
                )}
                {model.ready && (
                  <button
                    onClick={() => void handleSttDelete(model)}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    {t("onDeviceAi.sttDelete")}
                  </button>
                )}
              </div>
            </SettingsRow>
          ))}

          <SettingsRow
            label={t("onDeviceAi.sttPacingLabel")}
            description={t("onDeviceAi.sttPacingDescription")}
          >
            <select
              className="px-2 py-1.5 text-sm rounded-lg border border-border bg-background"
              value={settings.audioTranscription.androidOnDevice?.pacing ?? "capped"}
              onChange={(e) => handleSttPacing(e.target.value === "full" ? "full" : "capped")}
              aria-label={t("onDeviceAi.sttPacingLabel")}
            >
              <option value="capped">{t("onDeviceAi.sttPacingCapped")}</option>
              <option value="full">{t("onDeviceAi.sttPacingFull")}</option>
            </select>
          </SettingsRow>
        </>
      )}

      {macOs && (
        <>
          <SettingsRow
            label={t("onDeviceAi.appleFoundationLabel")}
            description={
              appleSnap
                ? t(appleFoundationDetailKey(appleFoundationResolved))
                : t("onDeviceAi.checking")
            }
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {appleSnap ? t(appleFoundationStatusKey(appleFoundationResolved)) : "…"}
              </span>
              {appleFoundationAvailable && <OnDeviceProcessingBadge />}
              <button
                type="button"
                onClick={() => void refreshApple()}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
              >
                {t("onDeviceAi.refresh")}
              </button>
            </div>
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

      {appleOs && !macOs && (
        <>
          <SettingsRow
            label={t("onDeviceAi.appleSectionTitle")}
            description={
              appleSnap?.foundationModels.status === "available"
                ? t("onDeviceAi.appleFoundationDetail.available")
                : appleSnap
                  ? t(
                      appleFoundationDetailKey(
                        resolveAppleFoundationReason(
                          appleSnap.foundationModels,
                          appleSnap.foundationReason,
                        ),
                      ),
                    )
                  : t("onDeviceAi.checking")
            }
          >
            <div className="flex items-center gap-3">
              {appleSnap?.foundationModels.status === "available" && (
                <OnDeviceProcessingBadge />
              )}
            </div>
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

      <SettingsRow
        label={t("onDeviceAi.androidSpeechLabel")}
        description={t("onDeviceAi.androidSpeechDescription")}
      >
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.audioTranscription.preferAndroidSpeech !== false}
            onChange={(e) => handleSpeechToggle(e.target.checked)}
            aria-label={t("onDeviceAi.androidSpeechLabel")}
          />
          <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t("onDeviceAi.appSearchLabel")}
        description={t("onDeviceAi.appSearchDescription")}
      >
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.features.androidAppSearchIndex !== false}
            onChange={(e) => handleAppSearchToggle(e.target.checked)}
            aria-label={t("onDeviceAi.appSearchLabel")}
          />
          <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t("onDeviceAi.licensedPacks")}
        description={t("onDeviceAi.licensedPacksDescription")}
      >
        <ul className="space-y-2 text-sm text-muted-foreground">
          {listLicensedModels().map((pack) => (
            <li key={pack.id} className="flex items-center justify-between gap-2">
              <span>
                {pack.displayName}
                {pack.sizeBytes
                  ? ` · ${t("onDeviceAi.packSize", { size: Math.round(pack.sizeBytes / 1_000_000) })}`
                  : ""}
              </span>
              {pack.id === "embeddinggemma" &&
                (embedStatus?.status === "downloadable" || embedStatus?.status === "unavailable") && (
                  <button
                    type="button"
                    onClick={() => void handleEmbedDownload()}
                    disabled={embedDownloading}
                    className="px-2 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground"
                  >
                    {t("onDeviceAi.download")}
                  </button>
                )}
            </li>
          ))}
        </ul>
      </SettingsRow>
    </SettingsSection>
  );
}

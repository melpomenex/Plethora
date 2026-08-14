/**
 * On-device AI (Gemini Nano) status and controls.
 *
 * Only rendered where the bridge can exist — an Android build. Everywhere else
 * the status is permanently `platform_unsupported`, and a settings row saying
 * so would be noise.
 */

import { useCallback, useEffect, useState } from "react";
import { SettingsRow, SettingsSection } from "./SettingsPage";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  isOnDeviceAiAvailable,
  isOnDeviceAiSupportedPlatform,
  requestModelDownload,
  type OnDeviceAiStatus,
} from "../../lib/ai/onDeviceAI";
import { ToastType, useToastStore } from "../common/Toast";
import { useI18n } from "../../lib/i18n";

/** Status -> i18n key suffix, so label and detail stay in step. */
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

  const [status, setStatus] = useState<OnDeviceAiStatus | null>(null);
  const [downloading, setDownloading] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await isOnDeviceAiAvailable());
  }, []);

  useEffect(() => {
    if (!isOnDeviceAiSupportedPlatform()) return;
    void refresh();
  }, [refresh]);

  // Nothing to configure on a platform with no bridge.
  if (!isOnDeviceAiSupportedPlatform()) return null;

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

  const handleToggle = (enabled: boolean) => {
    updateSettings({ ai: { ...settings.ai, preferOnDevice: enabled } });
    onChange();
  };

  return (
    <SettingsSection
      title={t("onDeviceAi.sectionTitle")}
      description={t("onDeviceAi.sectionDescription")}
    >
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
    </SettingsSection>
  );
}

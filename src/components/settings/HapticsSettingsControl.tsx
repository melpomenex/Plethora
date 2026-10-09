import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { getHapticsSnapshot, subscribeHaptics, type HapticsSnapshot } from "../../lib/feedback/haptics/service";
import type { HapticIntensity } from "../../lib/feedback/haptics/types";

export function HapticsSettingsControl({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const haptics = useSettingsStore((state) => state.settings.haptics);
  const updateSettingsCategory = useSettingsStore((state) => state.updateSettingsCategory);
  const [status, setStatus] = useState<HapticsSnapshot>(() => getHapticsSnapshot());

  useEffect(() => subscribeHaptics(setStatus), []);

  const supportLabel = !status.configured || status.capabilities.hardware === "unknown"
    ? t("haptics.statusUnknown")
    : status.capabilities.hardware === "available"
    ? t("haptics.statusAvailable")
    : t("haptics.statusUnavailable");
  const systemLabel = status.capabilities.systemPreference === "disabled"
    ? t("haptics.systemDisabled")
    : status.capabilities.systemPreference === "enabled"
      ? t("haptics.systemEnabled")
      : t("haptics.systemUnknown");

  return (
    <div className={compact ? "space-y-3" : "space-y-4 border-t border-border pt-4"}>
      <label className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block font-medium">{t("haptics.enabledLabel")}</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {t("haptics.enabledDescription")} {supportLabel} · {systemLabel}
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-primary"
          aria-label={t("haptics.enabledLabel")}
          checked={haptics.enabled}
          onChange={(event) => updateSettingsCategory("haptics", { enabled: event.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm">{t("haptics.intensityLabel")}</span>
        <select
          aria-label={t("haptics.intensityLabel")}
          value={haptics.intensity}
          onChange={(event) => updateSettingsCategory("haptics", { intensity: event.target.value as HapticIntensity })}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="subtle">{t("haptics.intensitySubtle")}</option>
          <option value="standard">{t("haptics.intensityStandard")}</option>
          <option value="strong">{t("haptics.intensityStrong")}</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{t("haptics.intensityDescription")}</p>
    </div>
  );
}

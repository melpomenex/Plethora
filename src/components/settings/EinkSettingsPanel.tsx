/**
 * E-Ink and Display Mode Settings Panel.
 *
 * Provides device-local controls for True E-Ink mode, hardware buttons,
 * paginated reading defaults, and tap zones.
 */

import { useState } from "react";
import { usePresentation } from "../../contexts/PresentationContext";
import {
  getEinkCapabilities,
  loadSavedEinkSettings,
  saveEinkSettings,
} from "../../lib/displayMode";
import type { DisplayMode, EinkSettings } from "../../types/display";
import { useI18n } from "../../lib/i18n";
import { BookOpen, DeviceMobile, Lightning } from "@phosphor-icons/react";

export function EinkSettingsPanel() {
  const { displayMode, setDisplayMode, isEinkMode } = usePresentation();
  const [einkSettings, setLocalEinkSettings] = useState<EinkSettings>(() =>
    loadSavedEinkSettings()
  );
  const capabilities = getEinkCapabilities();
  const { t } = useI18n();

  const handleModeChange = (mode: DisplayMode) => {
    setDisplayMode(mode);
    saveEinkSettings({ displayMode: mode });
    setLocalEinkSettings((prev) => ({ ...prev, displayMode: mode }));
  };

  const handleToggle = (key: keyof Omit<EinkSettings, "displayMode">, value: boolean) => {
    saveEinkSettings({ [key]: value });
    setLocalEinkSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-4">
      {/* Device Detection Banner */}
      {capabilities.isEinkDevice && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-muted/40 text-sm">
          <Lightning className="w-4 h-4 text-primary flex-shrink-0" />
          <span>
            {capabilities.detectedManufacturer
              ? `E-Ink hardware detected (${capabilities.detectedManufacturer}).`
              : "E-Ink / monochrome display detected."}
          </span>
        </div>
      )}

      {/* Mode Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t("settings.displayMode") || "Display Mode"}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "standard", label: "Standard", desc: "Full color & animations" },
              { id: "eink", label: "True E-Ink", desc: "Monochrome, zero ghosting" },
              { id: "auto", label: "Auto", desc: "Auto-detect hardware" },
            ] as const
          ).map((opt) => {
            const isSelected = displayMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleModeChange(opt.id)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <div className="text-sm text-foreground">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reader Optimizations */}
      <div className="space-y-3 pt-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <BookOpen className="w-4 h-4" />
          {t("settings.readerOptimizations") || "Reader Optimizations"}
        </h4>

        {/* Prefer Paginated Reading */}
        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("settings.preferPaginated") || "Prefer Paginated Reading"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("settings.preferPaginatedDesc") || "Discrete page turns instead of continuous scrolling to prevent E-ink ghosting"}
            </div>
          </div>
          <input
            type="checkbox"
            checked={einkSettings.preferPaginated}
            onChange={(e) => handleToggle("preferPaginated", e.target.checked)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
        </div>

        {/* Tap Zones */}
        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("settings.tapZones") || "One-Handed Tap Zones"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("settings.tapZonesDesc") || "Tap left/right edges to flip pages, tap center to show toolbar"}
            </div>
          </div>
          <input
            type="checkbox"
            checked={einkSettings.tapZones}
            onChange={(e) => handleToggle("tapZones", e.target.checked)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
        </div>

        {/* Volume Buttons Turn Pages */}
        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("settings.volumeTurnPages") || "Volume Buttons Turn Pages"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("settings.volumeTurnPagesDesc") || "Use hardware volume rocker to advance pages (preserves volume when audio is playing)"}
            </div>
          </div>
          <input
            type="checkbox"
            checked={einkSettings.volumeTurnPages}
            onChange={(e) => handleToggle("volumeTurnPages", e.target.checked)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
        </div>

        {/* Invert Volume Keys */}
        {einkSettings.volumeTurnPages && (
          <div className="flex items-center justify-between py-2 border-b border-border/50 pl-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t("settings.invertVolumeKeys") || "Invert Volume Buttons"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("settings.invertVolumeKeysDesc") || "Volume Up turns to next page, Volume Down turns to previous page"}
              </div>
            </div>
            <input
              type="checkbox"
              checked={einkSettings.invertVolumeKeys}
              onChange={(e) => handleToggle("invertVolumeKeys", e.target.checked)}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
          </div>
        )}

        {/* Grayscale Content */}
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("settings.grayscaleContent") || "Grayscale Images"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("settings.grayscaleContentDesc") || "Convert document figures and photos to high-contrast grayscale"}
            </div>
          </div>
          <input
            type="checkbox"
            checked={einkSettings.grayscaleContent}
            onChange={(e) => handleToggle("grayscaleContent", e.target.checked)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

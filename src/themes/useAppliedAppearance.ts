import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Theme } from "../types/theme";
import { resolveThemeAppearance } from "./resolveThemeAppearance";
import { useAppearanceEnvironment } from "./useAppearanceEnvironment";
import { preparePaperAssets } from "./paperAssets";
import { paperMaterialCss } from "./paperMaterialCss";
import { useSettingsStore } from "../stores/settingsStore";
import { usePresentation } from "../contexts/PresentationContext";
import { useBattery } from "../contexts/BatteryContext";

/** One lifecycle owner shared by chrome and every open reader. */
export function useAppliedAppearance(appliedTheme: Theme) {
  const preferences = useSettingsStore((s) => s.settings.appearance.materialPreferences);
  const environment = useAppearanceEnvironment();
  const { isEinkMode } = usePresentation();
  const { battery, onBattery } = useBattery();
  const [assetFailure, setAssetFailure] = useState<{ key: string; stage: "webp" | "png" } | null>(
    null
  );
  const preferenceKey = JSON.stringify([appliedTheme.id, preferences]);
  const appearance = useMemo(
    () =>
      resolveThemeAppearance(appliedTheme, preferences, {
        ...environment,
        eink: isEinkMode,
        lowBattery: onBattery && battery.level < 0.2,
        assetFailure: assetFailure?.key === preferenceKey ? assetFailure.stage : undefined,
      }),
    [
      appliedTheme,
      preferences,
      environment.dpr,
      environment.forcedColors,
      environment.highContrast,
      environment.deviceMemory,
      environment.saveData,
      environment.baseUrl,
      isEinkMode,
      onBattery,
      battery.level,
      assetFailure,
      preferenceKey,
    ]
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const styleId = "plethora-paper-material";
    let style = document.getElementById(styleId);
    if (!appearance.paper) {
      delete root.dataset.themeMaterial;
      style?.remove();
      return;
    }
    root.dataset.themeMaterial = "paper";
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      const nonce = document.querySelector<HTMLStyleElement>("#plethora-style-nonce")?.nonce;
      if (nonce) (style as HTMLStyleElement).nonce = nonce;
      document.head.appendChild(style);
    }
    style.textContent = `:root{${paperMaterialCss(appearance.paper)}}`;
    return () => {
      style?.remove();
      delete root.dataset.themeMaterial;
    };
  }, [appearance]);

  useEffect(() => {
    if (!appearance.paper) return;
    let active = true;
    const stage = assetFailure?.key === preferenceKey ? assetFailure.stage : undefined;
    preparePaperAssets(appearance.paper).catch(() => {
      if (active) setAssetFailure({ key: preferenceKey, stage: stage === "webp" ? "png" : "webp" });
    });
    return () => {
      active = false;
    };
  }, [appearance.paper?.grainUrl, appearance.paper?.variationUrl, preferenceKey]);

  return appearance;
}

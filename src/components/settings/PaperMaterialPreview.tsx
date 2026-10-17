import { useSettingsStore } from "../../stores/settingsStore";
import type { Theme } from "../../types/theme";
import { resolvePaperMaterial } from "../../themes/resolveThemeAppearance";
/** A real recipe sample rather than a screenshot or color-only swatch. */
export function PaperMaterialPreview({
  theme,
  compact = false,
}: {
  theme: Theme;
  compact?: boolean;
}) {
  const preferences = useSettingsStore((s) => s.settings.appearance.materialPreferences);
  const paper = resolvePaperMaterial(theme, preferences, { dpr: 1, baseUrl: document.baseURI });
  if (!paper) return null;
  return (
    <div
      aria-hidden="true"
      className={
        compact
          ? "h-6 w-14 shrink-0 overflow-hidden rounded-md border border-border"
          : "h-32 w-full overflow-hidden rounded-lg border border-border"
      }
      style={{
        backgroundColor: theme.colors.background,
        backgroundImage: `${paper.margin ? `linear-gradient(to right,transparent 12%,rgb(187 121 114 / 0.4) 12%,rgb(187 121 114 / 0.4) calc(12% + 1px),transparent calc(12% + 1px))` : "none"},${paper.ruling ? `repeating-linear-gradient(to bottom,transparent 0px,transparent 19px,rgb(129 153 160 / 0.25) 19px,rgb(129 153 160 / 0.25) 20px)` : "none"},url("${paper.grainUrl}")`,
        backgroundSize: "100% 100%,100% 20px,512px 512px",
      }}
    />
  );
}

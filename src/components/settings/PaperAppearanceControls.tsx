import { useTheme } from "../../contexts/ThemeContext";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  normalizePaperPreferences,
  PAPER_PRESET_ID,
  type PaperPreferences,
} from "../../themes/materials";
import { useResolvedThemeAppearance } from "../../themes/appearanceContext";
import { useI18n } from "../../lib/i18n";

export function PaperAppearanceControls() {
  const { theme } = useTheme();
  const saved = useSettingsStore((s) => s.settings.appearance.materialPreferences);
  const update = useSettingsStore((s) => s.updateSettingsCategory);
  const appearance = useResolvedThemeAppearance();
  const { t } = useI18n();
  if (theme.material?.preset !== PAPER_PRESET_ID) return null;
  const p = normalizePaperPreferences(saved?.[PAPER_PRESET_ID]);
  const change = (patch: Partial<PaperPreferences>) =>
    update("appearance", {
      materialPreferences: { ...saved, [PAPER_PRESET_ID]: { ...p, ...patch } },
    });
  return (
    <fieldset className="mt-4 space-y-3 text-sm text-foreground" data-paper-surface="inset">
      <legend className="font-medium">{t("paper.appearance")}</legend>
      <label className="flex items-center justify-between gap-3">
        {t("paper.detail")}
        <select
          className="rounded border border-border bg-input px-3 py-2"
          value={p.detail}
          onChange={(e) => change({ detail: e.target.value as PaperPreferences["detail"] })}
        >
          {(["subtle", "authentic", "maximum"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`paper.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        {t("paper.ruling")}
        <input
          type="checkbox"
          checked={p.ruling}
          onChange={(e) => change({ ruling: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        {t("paper.margin")}
        <input
          type="checkbox"
          checked={p.margin}
          disabled={!p.ruling}
          onChange={(e) => change({ margin: e.target.checked })}
        />
      </label>
      {appearance?.paper && p.detail !== appearance.paper.effectiveDetail && (
        <p className="text-muted-foreground">{t("paper.reduced")}</p>
      )}
      <button
        type="button"
        className="rounded border border-border px-3 py-2 focus-visible:outline-2"
        onClick={() => change({ detail: "authentic", ruling: true, margin: true })}
      >
        {t("paper.reset")}
      </button>
    </fieldset>
  );
}

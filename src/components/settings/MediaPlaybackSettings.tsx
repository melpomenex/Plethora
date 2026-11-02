import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilmStrip, Trash } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { isTauri, isNativeMobile } from "../../lib/tauri";
import {
  defaultSettings,
  useSettingsStore,
  type MediaPlaybackSettings,
} from "../../stores/settingsStore";
import type { MediaCacheUsage, MediaRuntimeCapabilities } from "../../lib/media/types";
import { formatCapabilityRows } from "../../lib/media/capabilities";
import {
  clearMediaCompatibilityCache,
  getMediaCompatibilityCacheUsage,
  getMediaRuntimeCapabilities,
  pruneMediaCompatibilityCache,
} from "../../api/mediaCompatibility";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";
import { cn } from "../../utils";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function MediaPlaybackSettings() {
  const { t } = useI18n();
  const { settings, updateSettingsCategory } = useSettingsStore();
  const media: MediaPlaybackSettings = settings.mediaPlayback ?? defaultSettings.mediaPlayback;
  const [usage, setUsage] = useState<MediaCacheUsage | null>(null);
  const [capabilities, setCapabilities] = useState<MediaRuntimeCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = isTauri() && !isNativeMobile();

  const update = useCallback(
    (patch: Partial<MediaPlaybackSettings>) => {
      updateSettingsCategory("mediaPlayback", { ...media, ...patch });
    },
    [media, updateSettingsCategory],
  );

  const refreshUsage = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setUsage(await getMediaCompatibilityCacheUsage());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    setError(null);
    try {
      setCapabilities(await getMediaRuntimeCapabilities(true));
      setUsage(await getMediaCompatibilityCacheUsage());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!desktop) return;
    void refreshUsage();
    void getMediaRuntimeCapabilities(false).then(setCapabilities).catch(() => undefined);
  }, [desktop, refreshUsage]);

  const rows = useMemo(
    () => (capabilities ? formatCapabilityRows(capabilities) : []),
    [capabilities],
  );

  const changeCacheLimit = async (value: number) => {
    update({ cacheLimitGb: value });
    if (desktop) {
      try {
        setUsage(await pruneMediaCompatibilityCache(value));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  };

  const clearCache = async () => {
    if (!isTauri()) return;
    if (!window.confirm(t("settings.mediaCache.clearConfirm", "Clear all prepared video copies? Original videos are not affected."))) {
      return;
    }
    setBusy(true);
    try {
      setUsage(await clearMediaCompatibilityCache());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <FilmStrip className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">{t("settings.mediaPlayback", "Media & Playback")}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.mediaPlaybackDesc", "Control how Plethora prepares local videos that the system player cannot handle directly.")}
        </p>
      </div>

      {!desktop && (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("settings.mediaDiagnostics.mobileOnly", "Video conversion is available on desktop only. Native playback and diagnostics remain available here.")}
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{t("settings.mediaCompatibilityMode", "Compatibility processing")}</h3>
        <span className="sr-only" data-settings-search-target="mediaPlayback.automatic-inexpensive" />
        <span className="sr-only" data-settings-search-target="mediaPlayback.ask" />
        <span className="sr-only" data-settings-search-target="mediaPlayback.never" />
        <span className="sr-only" data-settings-search-target="mediaPlayback.quality.balanced" />
        {([
          ["automatic-inexpensive", t("settings.mediaCompatibilityMode.automatic", "Automatic when inexpensive (recommended)"), t("settings.mediaCompatibilityMode.automaticDesc", "Remuxes and audio-only fixes run automatically. 4K, HDR, or long full conversions ask first.")],
          ["ask", t("settings.mediaCompatibilityMode.ask", "Ask before converting"), t("settings.mediaCompatibilityMode.askDesc", "Always ask before preparing a video.")],
          ["never", t("settings.mediaCompatibilityMode.never", "Never convert"), t("settings.mediaCompatibilityMode.neverDesc", "Only play videos the system can already handle.")],
        ] as const).map(([value, label, description]) => (
          <SettingsSearchTarget key={value} id={`mediaPlayback.${value}`} label={label}>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", media.compatibilityMode === value ? "border-primary bg-primary/5" : "border-border")}>
              <input
                type="radio"
                className="mt-1"
                name="media-compatibility-mode"
                checked={media.compatibilityMode === value}
                disabled={!desktop}
                onChange={() => update({ compatibilityMode: value })}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          </SettingsSearchTarget>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{t("settings.mediaConversionQuality", "Conversion quality")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["balanced", t("settings.mediaConversionQuality.balanced", "Balanced"), t("settings.mediaConversionQuality.balancedDesc", "Full conversions use at most 1080p. Remuxes always keep the original quality.")],
            ["quality", t("settings.mediaConversionQuality.quality", "Preserve quality"), t("settings.mediaConversionQuality.qualityDesc", "Keep the source resolution. Conversions take longer and use more space.")],
          ] as const).map(([value, label, description]) => (
            <SettingsSearchTarget key={value} id={`mediaPlayback.quality.${value}`} label={label}>
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", media.conversionQuality === value ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" className="mt-1" name="media-quality" checked={media.conversionQuality === value} disabled={!desktop} onChange={() => update({ conversionQuality: value })} />
                <span>
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
                </span>
              </label>
            </SettingsSearchTarget>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{t("settings.mediaHardwareAcceleration", "Hardware acceleration")}</h3>
        <select
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={media.hardwareAcceleration}
          disabled={!desktop}
          onChange={(event) => update({ hardwareAcceleration: event.target.value as "auto" | "off" })}
          aria-label={t("settings.mediaHardwareAcceleration", "Hardware acceleration")}
        >
          <option value="auto">{t("settings.mediaHardwareAcceleration.auto", "Automatic (verified encoder, software fallback)")}</option>
          <option value="off">{t("settings.mediaHardwareAcceleration.off", "Off (software only)")}</option>
        </select>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t("settings.mediaCache", "Compatibility cache")}</h3>
          <span className="text-xs text-muted-foreground">
            {usage ? `${formatBytes(usage.totalBytes)} / ${media.cacheLimitGb} GB` : "—"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.mediaCache.usage", "Prepared copies are stored separately from your original videos.")}</p>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={media.cacheLimitGb}
          disabled={!desktop}
          onChange={(event) => void changeCacheLimit(Number(event.target.value))}
          aria-label={t("settings.mediaCache.limit", "Cache limit")}
          className="w-full"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t("settings.mediaCache.limit", "Cache limit")}: {media.cacheLimitGb} GB</span>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50" disabled={!desktop || busy} onClick={() => void clearCache()}>
            <Trash className="h-3.5 w-3.5" />
            {t("settings.mediaCache.clear", "Clear cache")}
          </button>
        </div>
        {usage && (
          <p className="text-xs text-muted-foreground">{usage.artifactCount} {t("settings.mediaCache.artifacts", "prepared copies")}</p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t("settings.mediaDiagnostics", "Media support")}</h3>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50" disabled={!isTauri() || busy} onClick={() => void refreshDiagnostics()}>
            <ArrowClockwise className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            {t("settings.mediaDiagnostics.recheck", "Check again")}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{isTauri() ? t("settings.mediaDiagnostics.check", "Check which media formats this system can play.") : t("settings.mediaDiagnostics.desktopOnly", "Diagnostics are available in the desktop app.")}</p>
        ) : (
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                <span className="truncate text-muted-foreground">{row.label}</span>
                <span className={cn("font-medium", row.level === "supported" ? "text-emerald-600" : row.level === "unsupported" ? "text-destructive" : "text-muted-foreground")}>{row.level}</span>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </section>
    </div>
  );
}

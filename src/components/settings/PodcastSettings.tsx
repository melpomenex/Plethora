import React, { useEffect, useState, useCallback } from "react";
import { Broadcast, BatteryCharging, Clock, ShieldCheck } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { Switch } from "../common/Switch";
import {
  getPodcastAdSettings,
  updatePodcastAdSettings,
} from "../../api/podcastAd";
import type { PodcastAdSettings } from "../../types/podcastAd";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";

export function PodcastSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PodcastAdSettings>({
    id: "default",
    autoDetectAds: true,
    skipExternalAds: true,
    skipCrossPromo: true,
    skipSelfPromo: false,
    minConfidence: 0.85,
    minAdDurationSeconds: 10,
    mobileChargingOnly: true,
    processingMode: "smart",
  });
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getPodcastAdSettings()
      .then((cfg) => {
        if (mounted) {
          setSettings(cfg);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load podcast ad settings:", err);
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdate = useCallback(
    async (patch: Partial<PodcastAdSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        await updatePodcastAdSettings(next);
      } catch (err) {
        console.error("Failed to persist podcast ad settings:", err);
      }
    },
    [settings]
  );

  return (
    <div className="space-y-6 pt-4 border-t border-border/50">
      <div className="flex items-center gap-2">
        <Broadcast className="w-5 h-5 text-primary" weight="duotone" />
        <h3 className="text-base font-semibold text-foreground">
          Podcast Ad Removal & Navigation
        </h3>
      </div>

      <div className="space-y-4">
        {/* 1. Ad Removal Toggle */}
        <SettingsSearchTarget
          id="settings.podcast.ad_removal"
          label="Podcast Ad Removal"
        >
          <div className="flex items-start justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Automatic Ad Removal
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Automatically skip detected publisher ads, mid-rolls, and promotional segments.
              </div>
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <Switch
                checked={settings.autoDetectAds}
                onCheckedChange={(val) => handleUpdate({ autoDetectAds: val })}
                touchTarget
                aria-label="Automatic Ad Removal"
              />
            </div>
          </div>
        </SettingsSearchTarget>

        {/* 2. Auto Transcribe on Download */}
        <SettingsSearchTarget
          id="settings.podcast.auto_transcribe_on_download"
          label="Auto-Transcribe on Download"
        >
          <div className="flex items-start justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Auto-Transcribe on Download
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Queue newly downloaded episodes for background transcription and chapter generation.
              </div>
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <Switch
                checked={autoTranscribe}
                onCheckedChange={setAutoTranscribe}
                touchTarget
                aria-label="Auto-Transcribe on Download"
              />
            </div>
          </div>
        </SettingsSearchTarget>

        {/* 3. Mobile Charging Only */}
        <SettingsSearchTarget
          id="settings.podcast.mobile_charging_only"
          label="Mobile Charging Only"
        >
          <div className="flex items-start justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Defer Processing on Battery
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Wait until the mobile device is charging to execute on-device speech models and boundary refinement.
              </div>
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <Switch
                checked={settings.mobileChargingOnly}
                onCheckedChange={(val) => handleUpdate({ mobileChargingOnly: val })}
                touchTarget
                aria-label="Mobile Charging Only"
              />
            </div>
          </div>
        </SettingsSearchTarget>

        {/* 4. Minimum Ad Duration */}
        <SettingsSearchTarget
          id="settings.podcast.min_ad_duration"
          label="Minimum Ad Duration"
        >
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Minimum Ad Duration Threshold
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Sponsor segments shorter than this duration will not be skipped (default 10s).
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={3}
                max={60}
                value={settings.minAdDurationSeconds}
                onChange={(e) =>
                  handleUpdate({
                    minAdDurationSeconds: Math.max(3, parseInt(e.target.value) || 10),
                  })
                }
                className="w-16 px-2 py-1 text-sm bg-background border border-border rounded text-center text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Minimum Ad Duration Threshold in seconds"
              />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>
          </div>
        </SettingsSearchTarget>
      </div>
    </div>
  );
}

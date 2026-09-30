import { useCallback, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { Switch } from "../common/Switch";
import {
  useSettingsStore,
  defaultSettings,
  SPONSORBLOCK_CATEGORY_KEYS,
  type SponsorBlockSettings,
} from "../../stores/settingsStore";

const CACHE_DURATION_CHOICES = [0, 6, 12, 24, 48, 168];

function Row({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0 pt-0.5">
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          touchTarget
          aria-label={label}
        />
      </div>
    </div>
  );
}

/**
 * SponsorBlock settings.
 *
 * Rendered as a section of Settings → Integrations rather than as its own tab:
 * it is a third-party service like Obsidian, Anki or the YouTube transcript
 * server, and IntegrationSettings already renders one block per service.
 *
 * `updateSettingsCategory` merges one level deep, so the nested `categories`
 * object is always replaced wholesale here — spreading only the changed key
 * would leave the panel and the players disagreeing about the other six.
 */
export function SponsorBlockSettingsPanel() {
  const { t } = useI18n();
  const { settings, updateSettingsCategory } = useSettingsStore();

  // Null-safe fallback: a blob persisted before v14 can load without this key.
  const sponsorBlock: SponsorBlockSettings =
    settings.sponsorBlock ?? defaultSettings.sponsorBlock;

  const update = useCallback(
    (patch: Partial<SponsorBlockSettings>) => {
      updateSettingsCategory("sponsorBlock", { ...sponsorBlock, ...patch });
    },
    [sponsorBlock, updateSettingsCategory]
  );

  const setCategory = useCallback(
    (key: keyof SponsorBlockSettings["categories"], value: boolean) => {
      update({ categories: { ...sponsorBlock.categories, [key]: value } });
    },
    [sponsorBlock.categories, update]
  );

  const [cacheDraft, setCacheDraft] = useState<string | null>(null);
  const cacheHours = sponsorBlock.cacheDuration;
  const cacheValue =
    cacheDraft ?? (CACHE_DURATION_CHOICES.includes(cacheHours) ? String(cacheHours) : "48");

  return (
    <div className="space-y-1" data-testid="sponsorblock-settings">
      <p className="text-sm text-muted-foreground pb-2">
        {t("integrations.sponsorBlockDescription")}
      </p>

      <div className="divide-y divide-border">
        <Row
          label={t("integrations.sponsorBlockEnabled")}
          description={t("integrations.sponsorBlockEnabledDescription")}
          checked={sponsorBlock.enabled}
          onCheckedChange={(next) => update({ enabled: next })}
        />

        {/* The rest only matter once SponsorBlock is on; leaving them interactive
            while disabled would suggest they are doing something. */}
        <div
          className={cn(
            "divide-y divide-border transition-opacity",
            !sponsorBlock.enabled && "pointer-events-none opacity-50"
          )}
        >
          <Row
            label={t("integrations.sponsorBlockAutoSkip")}
            description={t("integrations.sponsorBlockAutoSkipDescription")}
            checked={sponsorBlock.autoSkip}
            onCheckedChange={(next) => update({ autoSkip: next })}
          />
          <Row
            label={t("integrations.sponsorBlockNotifications")}
            description={t("integrations.sponsorBlockNotificationsDescription")}
            checked={sponsorBlock.notifications}
            onCheckedChange={(next) => update({ notifications: next })}
          />
          <Row
            label={t("integrations.sponsorBlockPrivacy")}
            description={t("integrations.sponsorBlockPrivacyDescription")}
            checked={sponsorBlock.privacyMode}
            onCheckedChange={(next) => update({ privacyMode: next })}
          />

          <div className="py-2">
            <div className="text-sm font-medium text-foreground">
              {t("integrations.sponsorBlockCategories")}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 mb-2">
              {t("integrations.sponsorBlockCategoriesDescription")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {SPONSORBLOCK_CATEGORY_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-foreground min-w-0 truncate">
                    {t(`sponsorBlockCategory.${key}`)}
                  </span>
                  <Switch
                    checked={sponsorBlock.categories[key] ?? false}
                    onCheckedChange={(next) => setCategory(key, next)}
                    touchTarget
                    aria-label={t(`sponsorBlockCategory.${key}`)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {t("integrations.sponsorBlockCacheDuration")}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("integrations.sponsorBlockCacheDurationDescription")}
                </div>
              </div>
              <select
                value={cacheValue}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setCacheDraft(e.target.value);
                  update({ cacheDuration: next });
                }}
                onBlur={() => setCacheDraft(null)}
                aria-label={t("integrations.sponsorBlockCacheDuration")}
                className="flex-shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 min-h-[44px]"
              >
                {CACHE_DURATION_CHOICES.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <p className="flex items-start gap-1.5 pt-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        {t("integrations.sponsorBlockPlaybackOnly")}
      </p>
    </div>
  );
}

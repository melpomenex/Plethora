/**
 * Settings control for remote (off-device) automatic passage suggestions.
 *
 * Closes release blocker #8 of `complete-reader-extract-worthiness-integration`
 * ("Remote passage-scoring authorization has no Settings surface").
 *
 * The control never broadens a grant on its own:
 *  - it is unavailable when no cloud route is configured;
 *  - it explains when the configured destination already runs on-device
 *    (loopback counts as on-device) so no consent is needed;
 *  - a grant is finite (10/25/60 passages), source-scoped to every source the
 *    user reads, and revocable in one action;
 *  - consumed units are shown so the allowance is never a hidden number.
 */

import { useMemo, useState } from "react";
import { SettingsRow } from "./SettingsPage";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import {
  PASSAGE_REMOTE_GRANT_QUOTAS,
  normalizePassageRemoteScoringSetting,
} from "../../lib/ai/passageScoringConsent";
import {
  getRemotePassageScoringUsage,
  grantRemotePassageScoring,
  remotePassageScoringTarget,
  revokeRemotePassageScoring,
} from "../viewer/passageScoring/authorizationSettings";

const TOGGLE_CLASS =
  "w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary";

export function RemotePassageScoringSettings({ onChange }: { onChange: () => void }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const providers = useLLMProvidersStore((state) => state.providers);
  const [draftQuota, setDraftQuota] = useState<number>(PASSAGE_REMOTE_GRANT_QUOTAS[0]);

  // Recompute the destination when the provider registry changes. The helper
  // reads the active cloud config, so `providers` is the real dependency.
  const target = useMemo(() => remotePassageScoringTarget(), [providers]);
  const grant = normalizePassageRemoteScoringSetting(
    settings.ai.remotePassageScoring
  );
  const usage = getRemotePassageScoringUsage();
  const granted =
    Boolean(grant) &&
    Boolean(target) &&
    grant!.providerId === target!.providerId &&
    grant!.locality === target!.locality;

  const toggle = (next: boolean) => {
    if (next) {
      grantRemotePassageScoring({ maxClassifications: draftQuota });
    } else {
      revokeRemotePassageScoring();
    }
    onChange();
  };

  const quota = grant?.maxClassifications ?? draftQuota;
  const unavailableCopy = !target
    ? t("ai.passageScoring.remote.noProvider")
    : !target.offDevice
      ? t("ai.passageScoring.remote.localOnly")
      : null;
  const exhausted = Boolean(usage && usage.remaining === 0);

  return (
    <SettingsRow
      label={t("ai.passageScoring.remote.title")}
      description={t("ai.passageScoring.remote.description")}
      searchId="ai.extractWorthinessRemote"
    >
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <select
            aria-label={t("ai.passageScoring.remote.quotaLabel")}
            data-testid="remote-passage-scoring-quota"
            value={quota}
            disabled={granted || !target?.offDevice}
            onChange={(event) => setDraftQuota(Number(event.target.value))}
            className="px-2 py-1.5 bg-background border border-border rounded-lg text-foreground text-xs disabled:opacity-50"
          >
            {PASSAGE_REMOTE_GRANT_QUOTAS.map((value) => (
              <option key={value} value={value}>
                {t("ai.passageScoring.remote.quotaOption", { count: value })}
              </option>
            ))}
          </select>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              aria-label={t("ai.passageScoring.remote.title")}
              data-testid="remote-passage-scoring-toggle"
              className="sr-only peer"
              checked={granted}
              disabled={!target?.offDevice}
              onChange={(event) => toggle(event.target.checked)}
            />
            <div className={TOGGLE_CLASS} />
          </label>
        </div>
        {unavailableCopy ? (
          <p className="max-w-[280px] text-right text-[11px] text-muted-foreground">
            {unavailableCopy}
          </p>
        ) : granted && usage ? (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="remote-passage-scoring-usage"
          >
            {t("ai.passageScoring.remote.used", {
              used: usage.used,
              max: usage.allowed,
            })}
          </p>
        ) : null}
        {granted && exhausted ? (
          <button
            type="button"
            onClick={() => {
              revokeRemotePassageScoring();
              grantRemotePassageScoring({ maxClassifications: quota });
              onChange();
            }}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {t("ai.passageScoring.remote.renew")}
          </button>
        ) : null}
      </div>
    </SettingsRow>
  );
}

import { useSettingsStore } from "../../stores/settingsStore";
import type { Settings } from "../../stores/settingsStore";
import { useEntitlementStore } from "../../stores/entitlementStore";
import { DEFAULT_PREMIUM_MONTHLY_ALLOWANCE_MINUTES } from "./config";
import { TranscriptionError } from "./errors";
import {
  canUseServerPremiumQuota,
  checkServerPremiumTranscriptionQuota,
  meterServerPremiumTranscriptionUsage,
  type TranscriptionQuotaSnapshot,
} from "./premiumQuotaClient";

function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

function minutesToSeconds(minutes: number): number {
  return minutes * 60;
}

function readLocalQuota(settings: Settings): { usedSeconds: number; limitSeconds: number } {
  const entitlement = useEntitlementStore.getState().getCapabilityState("transcription");
  if (entitlement.quota && entitlement.quota.limit > 0) {
    return {
      usedSeconds: entitlement.quota.used,
      limitSeconds: entitlement.quota.limit,
    };
  }
  return {
    usedSeconds: minutesToSeconds(settings.audioTranscription.premiumMinutesUsed ?? 0),
    limitSeconds: minutesToSeconds(
      settings.audioTranscription.premiumMonthlyAllowance
        ?? DEFAULT_PREMIUM_MONTHLY_ALLOWANCE_MINUTES,
    ),
  };
}

function assertWithinQuota(usedSeconds: number, limitSeconds: number, durationSeconds: number): void {
  const requested = Math.max(0, durationSeconds);
  if (usedSeconds + requested > limitSeconds) {
    const remainingMinutes = secondsToMinutes(Math.max(0, limitSeconds - usedSeconds));
    throw new TranscriptionError(
      `Premium transcription quota exceeded. You have ${remainingMinutes.toFixed(1)} minutes remaining this month.`,
      "INSUFFICIENT_BALANCE",
      { recoverable: false },
    );
  }
}

function applyQuotaSnapshotToEntitlements(snapshot: TranscriptionQuotaSnapshot): void {
  const store = useEntitlementStore.getState();
  const current = store.snapshot;
  const transcription = current.capabilities.transcription ?? { enabled: true };
  store.setSnapshot({
    ...current,
    capabilities: {
      ...current.capabilities,
      transcription: {
        ...transcription,
        enabled: transcription.enabled,
        quota: {
          used: snapshot.used,
          limit: snapshot.limit,
          window: snapshot.window,
          resetsAt: snapshot.resetsAt,
        },
      },
    },
  });
}

function mirrorQuotaToLocalSettings(snapshot: TranscriptionQuotaSnapshot): void {
  const store = useSettingsStore.getState();
  const audio = store.settings.audioTranscription;
  store.updateSettings({
    audioTranscription: {
      ...audio,
      premiumMinutesUsed: secondsToMinutes(snapshot.used),
      premiumMonthlyAllowance: secondsToMinutes(snapshot.limit),
    },
  });
}

export function getPremiumMonthlyAllowanceMinutes(settings: Settings): number {
  const { limitSeconds } = readLocalQuota(settings);
  return secondsToMinutes(limitSeconds);
}

export function getPremiumMinutesUsed(settings: Settings): number {
  const { usedSeconds } = readLocalQuota(settings);
  return secondsToMinutes(usedSeconds);
}

export async function checkPremiumTranscriptionAllowed(
  settings: Settings,
  durationSeconds: number,
): Promise<void> {
  if (canUseServerPremiumQuota()) {
    const snapshot = await checkServerPremiumTranscriptionQuota(durationSeconds);
    applyQuotaSnapshotToEntitlements(snapshot);
    mirrorQuotaToLocalSettings(snapshot);
    return;
  }

  const { usedSeconds, limitSeconds } = readLocalQuota(settings);
  assertWithinQuota(usedSeconds, limitSeconds, durationSeconds);
}

export async function recordPremiumTranscriptionUsage(
  durationSeconds: number,
  options: { providerId?: string; model?: string; idempotencyKey?: string } = {},
): Promise<void> {
  if (durationSeconds <= 0) return;

  if (canUseServerPremiumQuota()) {
    const snapshot = await meterServerPremiumTranscriptionUsage(durationSeconds, options);
    applyQuotaSnapshotToEntitlements(snapshot);
    mirrorQuotaToLocalSettings(snapshot);
    return;
  }

  const store = useSettingsStore.getState();
  const audio = store.settings.audioTranscription;
  const usedMinutes = getPremiumMinutesUsed(store.settings) + durationSeconds / 60;
  store.updateSettings({
    audioTranscription: {
      ...audio,
      premiumMinutesUsed: usedMinutes,
    },
  });
}

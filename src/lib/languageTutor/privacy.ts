import type { LearnerContextPacket } from "./types";

export type TutorProviderPath = "local" | "byo-cloud" | "managed-cloud" | "none";
export type TutorRetention = "session-only" | "persisted";

export interface TutorPrivacyPolicy {
  path: TutorProviderPath;
  requiresConsent: boolean;
  consented: boolean;
  sendsMaterialOffDevice: boolean;
  retention: TutorRetention;
  canExport: boolean;
  canDelete: boolean;
  disclosure: string;
}

export function resolveTutorPrivacyPolicy(input: {
  aiPath: "ondevice" | "cloud" | "none";
  cloudConsent: boolean | null;
  hasByoProvider?: boolean;
  persistTranscript?: boolean;
}): TutorPrivacyPolicy {
  const path: TutorProviderPath = input.aiPath === "ondevice"
    ? "local"
    : input.aiPath === "cloud"
      ? (input.hasByoProvider ? "byo-cloud" : "managed-cloud")
      : "none";
  const sendsMaterialOffDevice = path === "byo-cloud" || path === "managed-cloud";
  return {
    path,
    requiresConsent: sendsMaterialOffDevice,
    consented: !sendsMaterialOffDevice || input.cloudConsent === true,
    sendsMaterialOffDevice,
    retention: input.persistTranscript ? "persisted" : "session-only",
    canExport: true,
    canDelete: true,
    disclosure: path === "local"
      ? "Tutor material stays on this device."
      : sendsMaterialOffDevice
        ? "Selected material and bounded learner context are sent to the configured cloud provider only after consent."
        : "No tutor provider is configured.",
  };
}

export function redactTutorMaterial(material: string, maxCodeUnits = 1200): string {
  return material.replace(/\s+/g, " ").trim().slice(0, Math.max(0, maxCodeUnits));
}

export function redactTutorContext(context: LearnerContextPacket | undefined): LearnerContextPacket | undefined {
  if (!context) return undefined;
  return {
    ...context,
    items: context.items.slice(0, 24).map((item) => ({ ...item, redacted: true })),
    currentSource: undefined,
  };
}

/**
 * Cloud-AI first-use disclosure gate (Change C §4 / design decision 4).
 *
 * One-time modal PER PROVIDER CLASS (not per action): the first time a user
 * invokes a feature that transmits content to a configured cloud AI provider
 * (AI actions, embeddings, transcription, TTS), they are told what content
 * leaves the device, which provider class receives it, why, whether it is a
 * BYO key or Plethora-hosted destination, and what the local alternative is.
 *
 * Semantics:
 * - Local-first providers (Ollama, on-device, system engines) NEVER trigger it
 *   (`isLocal: true` short-circuits to allowed).
 * - The acceptance is persisted per provider class; "don't ask again" is
 *   honored. A change of provider class (e.g. BYO key → Plethora-hosted)
 *   re-prompts once.
 * - If persistence is unavailable (storage failure), the gate degrades to
 *   asking every session rather than silently transmitting (design Failure
 *   Behavior).
 * - A registered presenter that is DECLINED denies the operation outright.
 * - No presenter at all (headless/test contexts) proceeds without persisting;
 *   the app shell always registers one, so end users are always asked.
 *
 * This module is UI-free; the app shell wires a presenter via
 * `setCloudAiDisclosurePresenter` (see `cloudAiDisclosureUi.ts`). Billing
 * consent (`aiBillingConsent.ts`) is a SEPARATE concern and continues to run
 * independently at its own call sites.
 */

/** Provider classes that trigger distinct disclosures. */
export type CloudAiProviderClass = 'plethora-hosted' | 'byo-key';

/** Feature classes that can transmit content to cloud AI. */
export type CloudAiFeatureClass = 'ai_actions' | 'embeddings' | 'transcription' | 'tts';

const STORAGE_KEY = 'plethora.privacy.cloudAiDisclosure.v1';

interface AckRecord {
  providerClass: CloudAiProviderClass;
  acknowledgedAt: string;
}

/**
 * Map a concrete provider id onto its disclosure class. Only the
 * Plethora-hosted destination is its own class; every other cloud provider is
 * user-configured ("bring your own key" or an external hosted endpoint).
 */
export function resolveCloudAiProviderClass(provider: string): CloudAiProviderClass {
  return provider === 'plethora' ? 'plethora-hosted' : 'byo-key';
}

function readAck(): AckRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AckRecord;
    if (parsed.providerClass !== 'plethora-hosted' && parsed.providerClass !== 'byo-key') {
      return null;
    }
    return parsed;
  } catch {
    // Storage failure or corrupt record: degrade to asking again.
    return null;
  }
}

/** The provider class the user already acknowledged, if any. */
export function getAcknowledgedProviderClass(): CloudAiProviderClass | null {
  return readAck()?.providerClass ?? null;
}

/** True when this exact provider class was already disclosed and accepted. */
export function isCloudAiDisclosed(providerClass: CloudAiProviderClass): boolean {
  return readAck()?.providerClass === providerClass;
}

/** Persist acceptance for a provider class. Storage failure is swallowed on purpose. */
export function acknowledgeCloudAiDisclosure(providerClass: CloudAiProviderClass): void {
  try {
    const record: AckRecord = {
      providerClass,
      acknowledgedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Design Failure Behavior: without persistence the gate asks every session.
  }
}

/** Clear any persisted acknowledgment (Privacy Center "ask me again" affordance). */
export function resetCloudAiDisclosure(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface CloudAiDisclosureInfo {
  featureClass: CloudAiFeatureClass;
  providerClass: CloudAiProviderClass;
  /** Concrete provider id/label for message copy. */
  provider: string;
}

export type CloudAiDisclosurePresenter = (info: CloudAiDisclosureInfo) => Promise<boolean>;

let presenter: CloudAiDisclosurePresenter | null = null;

/** Register the modal presenter (app shell) or null to disable prompting. */
export function setCloudAiDisclosurePresenter(p: CloudAiDisclosurePresenter | null): void {
  presenter = p;
}

export interface EnsureCloudAiDisclosureOptions {
  featureClass: CloudAiFeatureClass;
  provider: string;
  /**
   * True for local-first destinations (Ollama, localhost endpoints, on-device
   * engines, system TTS). Local providers never transmit off-device content,
   * so they never trigger the disclosure.
   */
  isLocal?: boolean;
}

/**
 * Gate a cloud-AI egress point. Returns true when the operation may proceed:
 * the destination is local, or the provider class was already disclosed, or
 * the user just accepted.
 *
 * Presenter handling:
 * - A registered presenter that resolves false DENIES the operation (fail
 *   closed — a user decline never silently transmits).
 * - NO presenter (headless/tests before the app shell registers one)
 *   proceeds WITHOUT persisting an acknowledgment: the disclosure is a UI
 *   concern, and the real app shell always registers the default presenter,
 *   so end users are always asked once per provider class.
 */
export async function ensureCloudAiDisclosure(
  opts: EnsureCloudAiDisclosureOptions
): Promise<boolean> {
  if (opts.isLocal) return true;
  const providerClass = resolveCloudAiProviderClass(opts.provider);
  if (isCloudAiDisclosed(providerClass)) return true;
  const p = presenter;
  if (!p) return true;
  const accepted = await p({ featureClass: opts.featureClass, providerClass, provider: opts.provider });
  if (accepted) acknowledgeCloudAiDisclosure(providerClass);
  return accepted;
}

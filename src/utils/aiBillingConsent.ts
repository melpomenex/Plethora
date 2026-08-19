/**
 * Shared paid-operation consent gate for AI billing safety (OpenSpec
 * `ai-billing-safety`, requirement #14).
 *
 * Policy: an API key authorizes a provider, it does not consent to billing.
 * Two persisted flags gate every billable path:
 *   - `embedding.paidEmbeddingsEnabled` (default false)
 *   - `tts.paidTtsEnabled` (default false)
 *
 * Explicit user actions (enable indexing / reindex, semantic-graph build,
 * neural mode, voice preview, audio-edition generation, read-aloud) call
 * `requestPaidConsent` when a billable provider is configured but the flag is
 * off; the app-shell-registered handler surfaces the opt-in surface. Enabling
 * persists the flag, so consent is one-time, never per chunk / per call.
 * Implicit / query-side paths (`resolveEmbeddingConfigForRag`) silently degrade
 * to a non-billable path instead.
 */

import { useSettingsStore } from "../stores/settingsStore";

/** Embedding providers that bill an external API (everything except Ollama). */
export const CLOUD_EMBEDDING_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "cohere",
  "openrouter",
]);

/**
 * TTS providers that bill an external API. `openai-compatible` is deliberately
 * NOT in this set: its base URL commonly points at a local OpenAI-compatible
 * server (`http://localhost:8000/v1`), which is free/local. `pocket`, `system`
 * and `android` are free/local by nature.
 */
export const PAID_TTS_PROVIDERS: ReadonlySet<string> = new Set([
  "fal",
  "groq",
  "openrouter",
  "elevenlabs",
  "openai",
  "plethora",
]);

export function isPaidEmbeddingProvider(provider: string): boolean {
  return CLOUD_EMBEDDING_PROVIDERS.has(provider);
}

export function isPaidTtsProvider(providerId: string): boolean {
  return PAID_TTS_PROVIDERS.has(providerId);
}

export type PaidConsentKind = "embeddings" | "tts" | "ai-fallback";

export interface PaidConsentRequest {
  kind: PaidConsentKind;
  /** Provider id (embedding provider or TTS adapter id). */
  provider: string;
  /** Optional model id for a clearer opt-in message. */
  model?: string;
  /** Human label shown in the opt-in surface. */
  label: string;
  /**
   * Optional workload detail (e.g. "~12 items will be embedded") shown in the
   * opt-in message so the user sees the scope before enabling.
   */
  detail?: string;
}

/**
 * Handler that surfaces the paid-consent opt-in UX and resolves whether the
 * operation may proceed (true = consent given AND the flag persisted). The app
 * shell registers one at startup; tests register a stub. When no handler is
 * registered the request is DENIED (safe default — never silently bill).
 */
export type PaidConsentHandler = (request: PaidConsentRequest) => Promise<boolean>;

let paidConsentHandler: PaidConsentHandler | null = null;

export function setPaidConsentHandler(handler: PaidConsentHandler | null): void {
  paidConsentHandler = handler;
}

export function getPaidConsentHandler(): PaidConsentHandler | null {
  return paidConsentHandler;
}

/** Session-only memo of denied consents so implicit surfaces do not re-prompt. */
const deniedThisSession = new Set<string>();

export function clearPaidConsentDenials(): void {
  deniedThisSession.clear();
}

function requestKey(kind: PaidConsentKind, provider: string): string {
  return `${kind}:${provider}`;
}

/**
 * Ask the user for consent to a paid operation. Returns true when consent was
 * granted and persisted. Returns false when denied or no handler is registered.
 * A denial is remembered for the session so a user who cancels is not
 * re-prompted on every queued chunk / repeated call.
 */
export async function requestPaidConsent(request: PaidConsentRequest): Promise<boolean> {
  const key = requestKey(request.kind, request.provider);
  if (deniedThisSession.has(key)) return false;
  const handler = paidConsentHandler;
  if (!handler) return false;
  const granted = await handler(request);
  if (!granted) deniedThisSession.add(key);
  return granted;
}

/** Read the persisted paid-embeddings consent flag (settings arg or store). */
export function paidEmbeddingsEnabled(
  settings?: { embedding?: { paidEmbeddingsEnabled?: boolean } }
): boolean {
  if (settings) return settings.embedding?.paidEmbeddingsEnabled === true;
  return useSettingsStore.getState().settings.embedding.paidEmbeddingsEnabled === true;
}

/** Read the persisted paid-TTS consent flag (settings arg or store). */
export function paidTtsEnabled(
  settings?: { tts?: { paidTtsEnabled?: boolean } }
): boolean {
  if (settings) return settings.tts?.paidTtsEnabled === true;
  return useSettingsStore.getState().settings.tts.paidTtsEnabled === true;
}

/**
 * True when the configured embedding provider is billable AND the user has not
 * enabled paid embeddings (a gate that must hold before any cloud embed).
 */
export function cloudEmbeddingRequiresConsent(
  provider: string,
  settings?: { embedding?: { paidEmbeddingsEnabled?: boolean } }
): boolean {
  return isPaidEmbeddingProvider(provider) && !paidEmbeddingsEnabled(settings);
}

/** True when the active TTS provider is billable AND paid TTS consent is off. */
export function cloudTtsRequiresConsent(
  providerId: string,
  settings?: { tts?: { paidTtsEnabled?: boolean } }
): boolean {
  return isPaidTtsProvider(providerId) && !paidTtsEnabled(settings);
}

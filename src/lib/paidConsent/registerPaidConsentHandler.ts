/**
 * App-shell registration of the paid-operation consent handler
 * (OpenSpec `ai-billing-safety`, requirement #14).
 *
 * Registered once at startup. When a billable embedding/TTS operation is
 * attempted with the relevant consent flag off, the handler surfaces the
 * opt-in modal. Confirming persists the flag (so consent is one-time, never
 * per chunk / per call) and lets the operation proceed; cancelling denies it.
 *
 * The handler lives behind `setPaidConsentHandler` so tests can install a
 * deterministic stub and non-UI contexts (server-side / headless) deny by
 * default without ever prompting.
 */

import { ModalType, useModalStore } from "../../components/common/Modal";
import { useSettingsStore } from "../../stores/settingsStore";
import { t } from "../i18n";
import { setPaidConsentHandler, type PaidConsentRequest } from "../../utils/aiBillingConsent";

function messageFor(request: PaidConsentRequest): { title: string; message: string } {
  const workload = request.detail ? `\n\n${request.detail}` : "";
  switch (request.kind) {
    case "tts":
      return {
        title: t("paidConsent.ttsTitle"),
        message:
          t("paidConsent.ttsMessage", {
            label: request.label,
            provider: request.provider,
            model: request.model ?? "",
          }) + workload,
      };
    case "embeddings":
      return {
        title: t("paidConsent.embeddingsTitle"),
        message:
          t("paidConsent.embeddingsMessage", {
            label: request.label,
            provider: request.provider,
            model: request.model ?? "",
          }) + workload,
      };
    case "ai-fallback":
      return {
        title: t("paidConsent.aiFallbackTitle"),
        message: t("paidConsent.aiFallbackMessage"),
      };
  }
}

function persistConsent(kind: PaidConsentRequest["kind"]): void {
  const store = useSettingsStore.getState();
  if (kind === "tts") {
    useSettingsStore.setState({
      settings: { ...store.settings, tts: { ...store.settings.tts, paidTtsEnabled: true } },
    });
  } else if (kind === "embeddings") {
    useSettingsStore.setState({
      settings: {
        ...store.settings,
        embedding: { ...store.settings.embedding, paidEmbeddingsEnabled: true },
      },
    });
  }
  // `ai-fallback` consent is per-occurrence and not persisted — re-confirmed
  // each time the user explicitly enables cloud fallback.
}

export function registerPaidConsentHandler(): () => void {
  setPaidConsentHandler(async (request) => {
    // Re-check the persisted flag first: a concurrent opt-in may have already
    // granted consent, in which case the operation can proceed without a prompt.
    const current = useSettingsStore.getState().settings;
    if (request.kind === "tts" && current.tts?.paidTtsEnabled === true) return true;
    if (request.kind === "embeddings" && current.embedding?.paidEmbeddingsEnabled === true) {
      return true;
    }

    const { title, message } = messageFor(request);
    const granted = await useModalStore.getState().showModal({
      type: ModalType.Confirm,
      title,
      message,
      confirmText: t("paidConsent.enable"),
      cancelText: t("paidConsent.cancel"),
      variant: "warning",
    });

    if (!granted) return false;
    persistConsent(request.kind);
    return true;
  });

  return () => setPaidConsentHandler(null);
}

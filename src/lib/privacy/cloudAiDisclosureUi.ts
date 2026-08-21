/**
 * Default UI presenter for the cloud-AI first-use disclosure (Change C §4).
 *
 * Kept separate from the pure gate logic in `cloudAiDisclosure.ts` so tests
 * and headless contexts never import the modal store. The message covers the
 * design-required content: what leaves the device, which provider class
 * receives it, why, BYO vs Plethora-hosted, and the local alternative.
 */

import { ModalType, useModalStore } from "../../components/common/Modal";
import type { CloudAiDisclosureInfo } from "./cloudAiDisclosure";

const FEATURE_LABELS: Record<CloudAiDisclosureInfo["featureClass"], string> = {
  ai_actions: "AI actions (summaries, flashcards, tutoring)",
  embeddings: "semantic indexing",
  transcription: "audio transcription",
  tts: "neural text-to-speech",
};

function messageFor(info: CloudAiDisclosureInfo): string {
  const feature = FEATURE_LABELS[info.featureClass];
  const destination =
    info.providerClass === "plethora-hosted"
      ? "Plethora's hosted AI gateway"
      : `your configured provider "${info.provider}" (BYO API key)`;
  return [
    `To run ${feature}, Plethora sends the relevant content (document excerpts, query text, or audio) over an encrypted connection to ${destination}.`,
    info.providerClass === "plethora-hosted"
      ? "This provider is hosted by Plethora; content is processed ephemerally and is never used for training."
      : "Requests are billed to your own API key with that provider; Plethora proxies nothing unless a gateway is configured.",
    "You can always use local alternatives instead (on-device models, Ollama, system voices) — or mark documents Local-Only so they never leave this device.",
  ].join("\n\n");
}

/**
 * Show the one-time disclosure. Resolves true when the user accepts
 * ("Continue" — acceptance is persisted per provider class by the gate),
 * false when they cancel.
 */
export function defaultCloudAiDisclosurePresenter(info: CloudAiDisclosureInfo): Promise<boolean> {
  return useModalStore.getState().showModal({
    type: ModalType.Confirm,
    title: "Send content to cloud AI?",
    message: messageFor(info),
    confirmText: "Continue",
    cancelText: "Cancel",
    variant: "warning",
  });
}

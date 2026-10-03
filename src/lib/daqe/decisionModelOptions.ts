/**
 * Which decision model answers the ranker's questions.
 *
 * ## All four of these are real, and they are one protocol
 *
 * The PRD named **Jev**, **Laya**, and **Clef**. I previously reported that only
 * a custom engine was configurable and that the other two had no client. That was
 * wrong, and worth correcting plainly: all three are deployed versions of the
 * same **System One** protocol — `POST /v1/systemone`, with `choice` / `score` /
 * `noul` question types — which is exactly the shape the Rust `DecisionModelProvider`
 * trait was modelled on. OpenRouter serves a `decisions` modality speaking the
 * same protocol. So this list is configuration over one client
 * ({@link ./systemOne}), not four integrations.
 *
 * ## What each one is
 *
 * - **Jev** — TypeSafe AI, hosted. `$0.042`/M input tokens, output free. Needs an
 *   API key; without one it is unreachable, so the option reports that.
 * - **Laya** — Convai Innovations, Apache 2.0, ~0.4B params. The only one that can
 *   run on your own machine, either from downloaded weights or from a
 *   `laya-serve` instance you start.
 * - **Clef** — Cloudflare, Apache 2.0, open weights, served on Workers AI. Needs a
 *   Cloudflare API token and account id.
 * - **OpenRouter decisions** — `liquid/d1`, `upstage/solar-decide`,
 *   `inception/mercury-decide`, `togethercomputer/tev1-4b-experimental`. Needs an
 *   OpenRouter key.
 *
 * ## Why there is no "download" for the hosted ones
 *
 * Jev and the OpenRouter models are services; there are no weights to fetch.
 * Laya's weights *are* downloadable, and that path is
 * {@link ./decisionModelDownloads} plus the repository's existing Hugging Face
 * installer. Clef's weights are on Hugging Face under Apache 2.0 and can be run
 * through a System One server, but Workers AI is the supported route.
 */

import { CLOUD_PROVIDER_ID } from "../ai/providers/cloudProvider";
import { LOCAL_DECISION_ENGINE_PROVIDER_ID } from "../ai/providers/localModelProvider";

export { LOCAL_DECISION_ENGINE_PROVIDER_ID };

/** Where item content is allowed to go, per provider. */
export type DecisionModelPrivacy = "on-device" | "local" | "remote";

/** The `kind` a deployment needs from the caller. */
export type DecisionModelSetup =
  | "none"
  | "api-key"
  | "endpoint"
  | "endpoint-and-key"
  | "cloudflare-credentials"
  | "openrouter-key"
  | "openai-key";

export interface DecisionModelOption {
  id: string;
  labelKey: string;
  descriptionKey: string;
  privacy: DecisionModelPrivacy;
  /** What the deployment needs before it can answer. */
  setup: DecisionModelSetup;
  /** Documentation link, for a user who wants the vendor's own terms. */
  docsUrl?: string;
}

/** Sentinel for "no decision model"; the ranker's deterministic local fallbacks. */
export const NO_DECISION_MODEL_ID = "none";

/** The decision-model spine: whatever the AI settings already route through. */
export const DECISION_SPINE_ID = "spine";

export const JEV_PROVIDER_ID = "jev";
export const JEV_BASE_URL = "https://jevmodel.org";

export const LAYA_PROVIDER_ID = "laya";
/** The default address `laya-serve` listens on. */
export const LAYA_DEFAULT_BASE_URL = "http://127.0.0.1:8000";

export const CLEF_PROVIDER_ID = "clef";
export const CLEF_BASE_URL = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Cloudflare Clef decision models.
 *
 * Workers AI serves two variants:
 * - `@cf/cloudflare/clef-flash` (9B): low-latency, ~38.8ms median response time ($0.09/M input tokens).
 * - `@cf/cloudflare/clef` (27B): larger multimodal model for maximum precision ($0.24/M input tokens).
 */
export const CLEF_MODELS = [
  {
    id: "@cf/cloudflare/clef-flash",
    labelKey: "daqeModel.clef.flash",
    inputUsdPerMillion: 0.09,
    latencyMs: 39,
  },
  {
    id: "@cf/cloudflare/clef",
    labelKey: "daqeModel.clef.clef27b",
    inputUsdPerMillion: 0.24,
    latencyMs: 209,
  },
] as const;

export type ClefModelId = (typeof CLEF_MODELS)[number]["id"];

export function isClefModel(id: string): id is ClefModelId {
  return CLEF_MODELS.some((model) => model.id === id);
}

export const OPENAI_DECISIONS_PROVIDER_ID = "openai-decisions";
export const OPENAI_DECISIONS_BASE_URL = "https://api.openai.com/v1";

export const OPENROUTER_DECISIONS_PROVIDER_ID = "openrouter-decisions";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter decision models, with the pricing the catalogue reports.
 *
 * Hardcoded on purpose. The `decisions` modality models are **absent from
 * OpenRouter's public `/api/v1/models` list** and only appear via
 * `/api/v1/models/{id}/endpoints`, so a catalogue-driven picker would come up
 * empty. Output is free for all of them — the protocol bills input only.
 *
 * `inception/mercury-decide:free` is listed first: it costs nothing, which makes
 * it the right default for someone trying the feature.
 */
export const OPENROUTER_DECISION_MODELS = [
  {
    id: "inception/mercury-decide:free",
    labelKey: "daqeModel.openrouter.mercuryFree",
    inputUsdPerMillion: 0,
    contextLength: 32_768,
  },
  {
    id: "liquid/d1",
    labelKey: "daqeModel.openrouter.liquidD1",
    inputUsdPerMillion: 0.04,
    contextLength: 65_536,
  },
  {
    id: "upstage/solar-decide",
    labelKey: "daqeModel.openrouter.solarDecide",
    inputUsdPerMillion: 0.05,
    contextLength: 524_288,
  },
  {
    id: "togethercomputer/tev1-4b-experimental",
    labelKey: "daqeModel.openrouter.tev1",
    inputUsdPerMillion: 0.042,
    contextLength: 32_768,
  },
] as const;

export type OpenRouterDecisionModelId = (typeof OPENROUTER_DECISION_MODELS)[number]["id"];

export function isOpenRouterDecisionModel(
  id: string,
): id is OpenRouterDecisionModelId {
  return OPENROUTER_DECISION_MODELS.some((model) => model.id === id);
}

/**
 * The picker options, in the order they should read.
 *
 * The free OpenRouter model is listed before the paid ones so a user trying the
 * feature does not have to read a price to discover that trying it is free.
 */
export const DECISION_MODEL_OPTIONS: readonly DecisionModelOption[] = [
  {
    id: NO_DECISION_MODEL_ID,
    labelKey: "daqeModel.none",
    descriptionKey: "daqeModel.noneDesc",
    privacy: "on-device",
    setup: "none",
  },
  {
    id: DECISION_SPINE_ID,
    labelKey: "daqeModel.spine",
    descriptionKey: "daqeModel.spineDesc",
    privacy: "on-device",
    setup: "none",
  },
  {
    id: LOCAL_DECISION_ENGINE_PROVIDER_ID,
    labelKey: "daqeModel.localEngine",
    descriptionKey: "daqeModel.localEngineDesc",
    privacy: "local",
    setup: "endpoint",
    docsUrl: "https://github.com/NandhaKishorM/laya",
  },
  {
    id: OPENROUTER_DECISIONS_PROVIDER_ID,
    labelKey: "daqeModel.openrouter",
    descriptionKey: "daqeModel.openrouterDesc",
    privacy: "remote",
    setup: "openrouter-key",
    docsUrl: "https://openrouter.ai/docs/features/decisions",
  },
  {
    id: JEV_PROVIDER_ID,
    labelKey: "daqeModel.jev",
    descriptionKey: "daqeModel.jevDesc",
    privacy: "remote",
    setup: "api-key",
    docsUrl: "https://jevmodel.org/docs/",
  },
  {
    id: CLEF_PROVIDER_ID,
    labelKey: "daqeModel.clef",
    descriptionKey: "daqeModel.clefDesc",
    privacy: "remote",
    setup: "cloudflare-credentials",
    docsUrl: "https://developers.cloudflare.com/workers-ai/models/clef/",
  },
  {
    id: OPENAI_DECISIONS_PROVIDER_ID,
    labelKey: "daqeModel.openai",
    descriptionKey: "daqeModel.openaiDesc",
    privacy: "remote",
    setup: "openai-key",
    docsUrl: "https://platform.openai.com/docs/api-reference/decisions",
  },
  {
    id: LAYA_PROVIDER_ID,
    labelKey: "daqeModel.laya",
    descriptionKey: "daqeModel.layaDesc",
    privacy: "on-device",
    setup: "endpoint",
    docsUrl: "https://huggingface.co/convaiinnovations/laya",
  },
] as const;

/** Look up an option, or `undefined` for an id this build does not know. */
export function getDecisionModelOption(id: string): DecisionModelOption | undefined {
  return DECISION_MODEL_OPTIONS.find((option) => option.id === id);
}

/** The stored id read as a known option, falling back to "no model". */
export function coerceDecisionModelId(value: unknown): string {
  return typeof value === "string" && getDecisionModelOption(value) ? value : NO_DECISION_MODEL_ID;
}

/** Where a given option's content would go. */
export function privacyOf(id: string): DecisionModelPrivacy {
  return getDecisionModelOption(id)?.privacy ?? "on-device";
}

/** Whether a remote option is selected — which is what `allowRemote` gates. */
export function isRemoteDecisionModel(id: string): boolean {
  return privacyOf(id) === "remote";
}

/** Everything a chosen option needs before it can answer. */
export interface DecisionModelConfig {
  /** Bearer token, for Jev / Laya / the generic engine / OpenAI. */
  apiKey?: string;
  /** Override the default base URL. */
  baseUrl?: string;
  /** OpenRouter decision model id. */
  openrouterModelId?: string;
  /** Clef model id: `@cf/cloudflare/clef-flash` or `@cf/cloudflare/clef`. */
  clefModelId?: string;
  /** OpenAI decision model id override (defaults to gpt-6-luna). */
  openaiModelId?: string;
  /** Cloudflare account id, for Clef. */
  cloudflareAccountId?: string;
  /** Whether a remote option may contact the network at all. */
  allowRemote: boolean;
}

/**
 * What is still missing before the chosen option can actually run.
 *
 * Returned as a list of field names so the UI can name the gap and focus the
 * right input, instead of disabling a control and leaving the user to guess.
 */
export function setupGaps(
  id: string,
  config: DecisionModelConfig,
): string[] {
  const gaps: string[] = [];
  const option = getDecisionModelOption(id);
  if (!option) return ["unknownProvider"];

  // The remote opt-in is not a nicety. Without it the outbound payload builder is
  // unreachable, so a remote option silently does nothing — the worst possible
  // failure mode, because the UI would show a chosen model that never runs.
  if (option.privacy === "remote" && !config.allowRemote) {
    gaps.push("allowRemoteDecisionModel");
  }

  switch (option.setup) {
    case "none":
      break;
    case "api-key":
      if (!config.apiKey?.trim()) gaps.push("apiKey");
      break;
    case "endpoint":
      // An empty URL falls back to the provider's documented default, so this is
      // only a gap when the default itself is unreachable — never, for these.
      break;
    case "openrouter-key":
      if (!config.apiKey?.trim()) gaps.push("openrouterApiKey");
      if (!isOpenRouterDecisionModel(config.openrouterModelId ?? "")) {
        gaps.push("openrouterModelId");
      }
      break;
    case "cloudflare-credentials":
      if (!config.apiKey?.trim()) gaps.push("apiKey");
      if (!config.cloudflareAccountId?.trim()) gaps.push("cloudflareAccountId");
      break;
    case "openai-key":
      if (!config.apiKey?.trim()) gaps.push("openaiApiKey");
      break;
  }
  return gaps;
}

/** Whether the chosen option is fully configured and permitted to run. */
export function isDecisionModelReady(id: string, config: DecisionModelConfig): boolean {
  return setupGaps(id, config).length === 0;
}

/**
 * The base URL a chosen option talks to.
 *
 * One function so every provider's address lives in one place — a provider with a
 * wrong default is otherwise a bug per call site.
 */
export function baseUrlFor(id: string, config: DecisionModelConfig): string {
  // Normalized here rather than at the call site: this is the one place that
  // resolves an endpoint, and a trailing slash would otherwise become a doubled
  // separator the moment the URL is joined with a path.
  const override = config.baseUrl?.trim().replace(/\/+$/, "");
  switch (id) {
    case JEV_PROVIDER_ID:
      return override || JEV_BASE_URL;
    case LAYA_PROVIDER_ID:
      return override || LAYA_DEFAULT_BASE_URL;
    case OPENROUTER_DECISIONS_PROVIDER_ID:
      return override || OPENROUTER_BASE_URL;
    case CLEF_PROVIDER_ID:
      return override || `${CLEF_BASE_URL}/${config.cloudflareAccountId ?? ""}`;
    case OPENAI_DECISIONS_PROVIDER_ID:
      return override || OPENAI_DECISIONS_BASE_URL;
    case LOCAL_DECISION_ENGINE_PROVIDER_ID:
      return override || LAYA_DEFAULT_BASE_URL;
    default:
      return override || "";
  }
}

/** The model name to send, when the endpoint serves more than one. */
export function modelFor(id: string, config: DecisionModelConfig): string | undefined {
  switch (id) {
    case JEV_PROVIDER_ID:
      return "jev-latest";
    case OPENROUTER_DECISIONS_PROVIDER_ID:
      return config.openrouterModelId || OPENROUTER_DECISION_MODELS[0].id;
    case CLEF_PROVIDER_ID:
      return config.clefModelId || CLEF_MODELS[0].id;
    case OPENAI_DECISIONS_PROVIDER_ID:
      return config.openaiModelId || "gpt-6-luna";
    default:
      // Laya and a generic `laya-serve` serve one model and reject the field.
      return undefined;
  }
}

/** Whether the option needs the remote opt-in before it can be selected at all. */
export function requiresRemoteOptIn(id: string): boolean {
  return getDecisionModelOption(id)?.privacy === "remote";
}
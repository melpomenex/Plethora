/**
 * Probing a decision endpoint: "is my credential actually working?"
 *
 * ## Why this exists
 *
 * `setupGaps` can only tell whether a field is *non-empty*. That is a
 * configuration check, not a connection check, and the difference is the whole
 * point of this file: a reader who typed a revoked key, a wrong account id, or a
 * model id the endpoint does not serve would see a picker reporting "ready" and
 * a queue silently ranking by item type instead. That is the most
 * user-hostile failure this feature has, because nothing looks broken.
 *
 * ## What the probe asks
 *
 * One deliberately tiny, unambiguous request: two questions over a state that
 * has exactly one true reading. It costs a few dozen input tokens, which is
 * worth it to distinguish "your key is wrong" from "your key is fine".
 *
 * The expected answer is compared but a mismatch is a **warning, not a failure**.
 * A well-formed answer to a nonsense question means the transport, the
 * credential and the schema all work; it more likely means the endpoint is
 * serving a different model than the one configured. Reporting that as a failure
 * would teach readers to ignore the result.
 */

import {
  SystemOneError,
  callSystemOne,
  SYSTEM_ONE_LIMITS,
  type SystemOneClientOptions,
} from "./systemOne";
import {
  daqueDecisionRequest,
  daqueHttpProviderFor,
  type DaqeHttpResponse,
} from "../../api/ai";
import { modelFor, type DecisionModelConfig } from "./decisionModelOptions";
import { isTauri } from "../tauri";

/** The probe's two questions. Kept minimal so the call is nearly free. */
export const PROBE_QUESTIONS = {
  action: "observed_action",
  definite: "is_the_statement_definite",
} as const;

export const PROBE_CHOICE_OPTIONS = {
  submitted: "The user submitted the form.",
  cancelled: "The user cancelled the form.",
} as const;

export type ProbeOutcome = "ok" | "answered-unexpectedly" | "no-answer" | "failed";

export interface ProbeResult {
  outcome: ProbeOutcome;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** What the endpoint said it resolved, when it said. */
  resolvedModel?: string;
  /** Input tokens billed by the probe. Worth surfacing: it is not free. */
  inputTokens?: number;
  /** Present on `failed`. */
  error?: { reason: string; message: string; status?: number };
  /** Human-readable detail, already localized by the caller's i18n layer. */
  detail?: string;
}

const PROBE_STATE = "The user clicked the Submit button.";
const EXPECTED_CHOICE = "submitted";

/**
 * Send the probe.
 *
 * Never throws. A probe that raised would need a try/catch at every call site,
 * and the interesting outcome *is* the failure — so failure is a return value.
 */
export async function probeDecisionModel(
  client: SystemOneClientOptions,
): Promise<ProbeResult> {
  const started = now();
  try {
    const response = await callSystemOne(
      {
        // A probe should fail fast: it is a UI affordance, not a ranking pass.
        timeoutMs: Math.min(client.timeoutMs ?? 8_000, 10_000),
        ...client,
      },
      {
        state: PROBE_STATE,
        questions: {
          [PROBE_QUESTIONS.action]: {
            type: "choice",
            instructions: "Which of these did the user do?",
            criteria: { ...PROBE_CHOICE_OPTIONS },
          },
          [PROBE_QUESTIONS.definite]: {
            type: "noul",
            instructions: "Is the user's action definitely complete rather than in progress?",
          },
        },
      },
      // Stable per endpoint so a reader pressing the button twice in a session
      // settles against the same billing record rather than paying twice.
      { idempotencyKey: `daqe-probe:${client.baseUrl}:${client.model ?? "default"}` },
    );

    const latencyMs = now() - started;
    const answers = response?.answers ?? {};
    const choiceAnswer = answers[PROBE_QUESTIONS.action];
    const choice =
      choiceAnswer && typeof (choiceAnswer as { choice?: unknown }).choice === "string"
        ? (choiceAnswer as { choice: string }).choice
        : null;
    const noulAnswer = answers[PROBE_QUESTIONS.definite];
    const noul =
      noulAnswer && typeof (noulAnswer as { noul?: unknown }).noul === "number"
        ? (noulAnswer as { noul: number }).noul
        : null;

    const base = {
      latencyMs,
      resolvedModel: response?.model,
      inputTokens: response?.usage?.input_tokens,
    };

    if (choice === null && noul === null) {
      // A 200 with no usable answers is not a working endpoint; it is something
      // answering, but not the decisions protocol.
      return {
        ...base,
        outcome: "no-answer",
        detail: "reachable, but it answered no question we asked",
      };
    }

    if (choice !== EXPECTED_CHOICE) {
      return {
        ...base,
        outcome: "answered-unexpectedly",
        detail: `answered, but "${choice ?? "nothing"}" for an obvious question`,
      };
    }

    return { ...base, outcome: "ok" };
  } catch (error) {
    const latencyMs = now() - started;
    if (error instanceof SystemOneError) {
      return {
        outcome: "failed",
        latencyMs,
        error: {
          reason: error.reason,
          message: error.message,
          status: error.status,
        },
      };
    }
    return {
      outcome: "failed",
      latencyMs,
      error: { reason: "unreachable", message: String(error) },
    };
  }
}

/** Whether the probe means the endpoint is usable as configured. */
export function probeSucceeded(result: ProbeResult): boolean {
  return result.outcome === "ok";
}

/**
 * Whether a configured provider is *currently* answering.
 *
 * Distinct from `setupGaps`, which only asks whether the fields are filled in.
 * A provider can be fully configured and still be failing — a revoked key, an
 * exhausted balance, a service outage — and that is the state a reader most needs
 * to be told about, because the queue is quietly using the local fallback.
 */
export interface DecisionModelStatus {
  /** Whether a provider is chosen at all. */
  configured: boolean;
  /** The last probe or ranking outcome, if any has happened. */
  lastResult?: ProbeResult;
  /** When that outcome was observed. */
  observedAt?: number;
}

export type DecisionModelLiveState = "unconfigured" | "untested" | "working" | "degraded";

/**
 * Reduce a status to the one thing a surface needs to say.
 *
 * `degraded` is the important state: configured, tested, and *not* answering. A
 * surface that shows "configured" here would be lying about what is ranking the
 * queue.
 */
export function decisionModelLiveState(
  status: DecisionModelStatus,
  nowMs: number = Date.now(),
): DecisionModelLiveState {
  if (!status.configured) return "unconfigured";
  if (!status.lastResult || !status.observedAt) return "untested";

  // A result older than this is not evidence about the present. Providers go
  // down; a stale green tick would outlive the outage.
  const STALE_AFTER_MS = 30 * 60 * 1000;
  if (nowMs - status.observedAt > STALE_AFTER_MS) return "untested";

  return probeSucceeded(status.lastResult) ? "working" : "degraded";
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Re-exported so the probe's state is validated by the same limits as a ranking call. */
export { SYSTEM_ONE_LIMITS };

/**
 * Probe through the backend, which is the only route that works for a provider
 * without browser CORS.
 *
 * Returns `null` when there is no backend — a browser build, or no Tauri host —
 * so the caller can fall back to a direct fetch rather than reporting a
 * connection failure that is really an environment limitation.
 */
async function probeViaBackend(
  providerId: string,
  config: DecisionModelConfig,
): Promise<ProbeResult | null> {
  if (!isTauri()) return null;
  const provider = daqueHttpProviderFor(providerId);
  if (!provider) return null;

  const started = now();
  let response: DaqeHttpResponse;
  try {
    response = await daqueDecisionRequest({
      provider,
      baseUrl: config.baseUrl,
      model: modelFor(providerId, config),
      cloudflareAccountId: config.cloudflareAccountId,
      state: PROBE_STATE,
      questions: {
        [PROBE_QUESTIONS.action]: {
          type: "choice",
          instructions: "Which of these did the user do?",
          criteria: { ...PROBE_CHOICE_OPTIONS },
        },
        [PROBE_QUESTIONS.definite]: {
          type: "noul",
          instructions:
            "Is the user's action definitely complete rather than in progress?",
        },
      },
      timeoutMs: 10_000,
    });
  } catch (error) {
    return {
      outcome: "failed",
      latencyMs: now() - started,
      error: { reason: "unreachable", message: String(error) },
    };
  }

  return readBackendProbe(response, now() - started);
}

/** Turn the backend's HTTP outcome into a probe result. */
export function readBackendProbe(response: DaqeHttpResponse, latencyMs: number): ProbeResult {
  const raw = response.body as Record<string, unknown> | undefined;
  const payload = (raw?.result && typeof raw.result === "object" ? raw.result : raw) as
    | Record<string, unknown>
    | undefined;

  const inputTokens =
    (payload?.usage as { input_tokens?: number } | undefined)?.input_tokens ??
    (raw?.usage as { input_tokens?: number } | undefined)?.input_tokens;
  const resolvedModel = (payload?.model as string | undefined) ?? (raw?.model as string | undefined);

  if (!response.ok) {
    return {
      outcome: "failed",
      latencyMs,
      // The endpoint that was actually called is the most useful thing to show
      // when the answer is "no": a wrong path and a wrong key look identical
      // otherwise.
      detail: response.url,
      error: {
        reason: response.reason ?? "http-error",
        message: response.error ?? "",
        status: response.status || undefined,
      },
      inputTokens,
    };
  }

  const answers =
    (payload?.answers as Record<string, unknown> | undefined) ??
    (raw?.answers as Record<string, unknown> | undefined) ??
    {};
  const choiceAnswer = answers[PROBE_QUESTIONS.action] as { choice?: unknown } | undefined;
  const choice = typeof choiceAnswer?.choice === "string" ? choiceAnswer.choice : null;
  const noulAnswer = answers[PROBE_QUESTIONS.definite] as { noul?: unknown } | undefined;
  const noul = typeof noulAnswer?.noul === "number" ? noulAnswer.noul : null;

  const base = { latencyMs, resolvedModel, inputTokens };

  if (choice === null && noul === null) {
    return { ...base, outcome: "no-answer", detail: response.url };
  }
  if (choice !== EXPECTED_CHOICE) {
    return {
      ...base,
      outcome: "answered-unexpectedly",
      detail: `answered, but "${choice ?? "nothing"}" for an obvious question`,
    };
  }
  return { ...base, outcome: "ok" };
}

/** Probe a stored selection, preferring the backend route. */
export async function probeSelectedModel(
  providerId: string,
  config: DecisionModelConfig,
): Promise<ProbeResult | null> {
  return probeViaBackend(providerId, config);
}

/**
 * Deterministic first-run protocol probe (change §13, task 10.4).
 *
 * Optional, opt-in ONLY (wired by an explicit caller flag): before the first
 * agent run against a (providerId, model) pair, a ≤256-token deterministic
 * probe validates that the provider actually returns a contract-compliant
 * agent-turn JSON object. Results are persisted session-locally per
 * (providerId, model, contract revision). Absent live evidence, compatibility
 * is never claimed.
 */

import { isParseFailure, parseStrictJson } from "../tasks/runTask";
import { validateAgentTurn } from "../schemas/agentTurn";
import type { AIProvider } from "../providers/types";

/** Bump when the agent-turn contract changes materially. */
export const AGENT_TURN_CONTRACT_REVISION = "agent-turn-v1";

export interface ProtocolProbeResult {
  providerId: string;
  model: string;
  revision: string;
  ok: boolean;
  at: number;
}

const probeResults = new Map<string, ProtocolProbeResult>();

export function probeKey(providerId: string, model: string | undefined): string {
  return `${providerId}::${model ?? "unknown"}`;
}

/** Deterministic probe prompt (≤256 tokens, content-free). */
export const PROTOCOL_PROBE_PROMPT =
  'Respond with ONE agent-turn JSON object: {"toolCalls":[],"finalAnswer":"smoke ok"}';

export function getProtocolProbe(
  providerId: string,
  model: string | undefined
): ProtocolProbeResult | undefined {
  return probeResults.get(probeKey(providerId, model));
}

export async function runProtocolProbe(
  provider: AIProvider,
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {}
): Promise<ProtocolProbeResult> {
  const providerId = provider.id;
  let model: string | undefined;
  const now = options.now ?? Date.now;
  try {
    const caps = await provider.getCapabilities();
    const res = await provider.generateStream(
      {
        requestId: `protocol-probe-${now()}`,
        text: PROTOCOL_PROBE_PROMPT,
        maxOutputTokens: 256,
        temperature: 0,
      },
      { stream: false, signal: options.signal }
    );
    model = res.baseModelName;
    const parsed = parseStrictJson(res.text);
    const ok =
      !isParseFailure(parsed) && validateAgentTurn(parsed.value).ok === true;
    const result: ProtocolProbeResult = {
      providerId,
      model: model ?? "unknown",
      revision: AGENT_TURN_CONTRACT_REVISION,
      ok,
      at: now(),
    };
    probeResults.set(probeKey(providerId, model), result);
    return result;
  } catch (error) {
    const result: ProtocolProbeResult = {
      providerId,
      model: model ?? "unknown",
      revision: AGENT_TURN_CONTRACT_REVISION,
      ok: false,
      at: now(),
    };
    probeResults.set(probeKey(providerId, model), result);
    return result;
  }
}

/** Session-local; only used by tests. */
export function clearProtocolProbes(): void {
  probeResults.clear();
}

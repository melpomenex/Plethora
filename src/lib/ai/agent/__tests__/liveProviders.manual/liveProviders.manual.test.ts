/**
 * Opt-in live-provider suite (change 10.2). Skipped entirely unless
 * PLETHORA_LIVE_PROVIDERS=1. Asserts serving-model identity + agentTurn
 * compliance; never infers compatibility from plain chat.
 */

import { describe, expect, it } from "vitest";
import { CloudProvider } from "../../../providers/cloudProvider";
import { runProtocolProbe, getProtocolProbe, AGENT_TURN_CONTRACT_REVISION } from "../../protocolProbe";
import { validateAgentTurn } from "../../../schemas/agentTurn";
import { isParseFailure, parseStrictJson } from "../../../tasks/runTask";

const LIVE = process.env.PLETHORA_LIVE_PROVIDERS === "1";
const PROMPTS = 6;

function cloudProviderFor(provider: string, apiKey: string, baseUrl: string, model: string) {
  return new CloudProvider({
    chat: async (request) => {
      const { chatWithLLM } = await import("../../../../../api/llm");
      return chatWithLLM({
        provider: provider as never,
        model,
        messages: request.messages,
        temperature: 0,
        maxTokens: request.maxTokens,
        apiKey,
        baseUrl,
      });
    },
  });
}

async function assertCompliance(provider: CloudProvider, model: string) {
  const okCount = [];
  for (let i = 0; i < PROMPTS; i++) {
    const response = await provider.generateStream({
      requestId: `live-${i}`,
      text: 'Respond with one agent-turn JSON object: {"toolCalls":[],"finalAnswer":"smoke ok"}',
      maxOutputTokens: 256,
      temperature: 0,
    });
    // Serving-model identity: the response must name the configured model.
    expect(response.baseModelName).toBe(model);
    const parsed = parseStrictJson(response.text);
    const compliant = !isParseFailure(parsed) && validateAgentTurn(parsed.value).ok === true;
    okCount.push(compliant);
  }
  // ≥ N/6 prompts must be contract-compliant.
  const passRate = okCount.filter(Boolean).length / PROMPTS;
  expect(passRate).toBeGreaterThanOrEqual(0.5);
}

describe("live provider agent-turn compliance (opt-in)", () => {
  it("Ollama (locally installed) serves the configured model and complies", { skip: !LIVE }, async () => {
    const model = process.env.PLETHORA_LIVE_OLLAMA_MODEL ?? "llama3.2";
    const provider = cloudProviderFor("ollama", "", "http://localhost:11434", model);
    await assertCompliance(provider, model);
    const probe = await runProtocolProbe(provider, { timeoutMs: 20_000 });
    expect(probe.revision).toBe(AGENT_TURN_CONTRACT_REVISION);
    expect(getProtocolProbe(provider.id, model)?.ok).toBe(probe.ok);
  });

  it("OpenRouter (explicit model) serves the configured model and complies", { skip: !LIVE }, async () => {
    const key = process.env.PLETHORA_LIVE_OPENROUTER_KEY;
    const model = process.env.PLETHORA_LIVE_OPENROUTER_MODEL;
    expect(key).toBeTruthy();
    expect(model).toBeTruthy();
    const provider = cloudProviderFor("openrouter", key!, "https://openrouter.ai/api/v1", model!);
    await assertCompliance(provider, model!);
  });

  it("Gemini (explicit model) serves the configured model and complies", { skip: !LIVE }, async () => {
    const key = process.env.PLETHORA_LIVE_GEMINI_KEY;
    const model = process.env.PLETHORA_LIVE_GEMINI_MODEL;
    expect(key).toBeTruthy();
    expect(model).toBeTruthy();
    const provider = cloudProviderFor(
      "gemini",
      key!,
      "https://generativelanguage.googleapis.com/v1beta/openai",
      model!
    );
    await assertCompliance(provider, model!);
  });
});

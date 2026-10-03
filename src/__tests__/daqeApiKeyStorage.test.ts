import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The decision-model API key must never reach the settings store.
 *
 * This is a regression guard for a mistake that was actually made: the key was
 * first added to `settings.daqe`, which persists to **localStorage**. A metered
 * credential — Jev bills per input token, OpenRouter likewise — sitting in
 * localStorage is readable by any script that reaches the page, and unlike a
 * setting it has a cost when leaked.
 *
 * So the rule is: settings may hold *that a key exists*, never the key.
 */
const root = join(process.cwd(), "src");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const SETTINGS_STORE = "stores/settingsStore.ts";

describe("decision model API keys", () => {
  it("keeps no plaintext key field in the settings shape", () => {
    const store = source(SETTINGS_STORE);
    // A boolean is the whole point: it is what the picker needs to render a
    // configured provider, and it cannot be used to call anything.
    expect(store).toContain("decisionApiKeySet: boolean");
    expect(store).not.toMatch(/decisionApiKey\??:\s*string/);
    expect(store).not.toContain("decisionApiKey: null");
  });

  it("defaults the flag to false, so no profile looks pre-configured", () => {
    expect(source(SETTINGS_STORE)).toContain("decisionApiKeySet: false");
  });

  it("routes writes through the keychain commands", () => {
    const api = source("api/ai.ts");
    expect(api).toContain("setDecisionApiKey");
    expect(api).toContain("clearDecisionApiKey");
    expect(api).toContain("hasDecisionApiKey");
    // The store command is what puts it in the OS keychain.
    expect(api).toContain('invokeCommand("set_api_key"');
  });

  it("reads back a masked key rather than the secret", () => {
    const api = source("api/ai.ts");
    expect(api).toContain('getMaskedApiKey');
    expect(api).toContain('invokeCommand<string | null>("get_masked_api_key"');
  });

  it.each([
    ["the decision-model picker", "components/queue/DaqeDecisionModelSettings.tsx"],
    ["the queue settings section", "components/settings/SmartQueuesSettings.tsx"],
  ])("never reads a secret in %s", (_label, path) => {
    const file = source(path);
    // Reading the key out of settings is the bug; reading a boolean is the fix.
    expect(file).not.toMatch(/\.decisionApiKey\b(?!\s*Set)/);
  });

  it("writes the key from local component state, then drops it", () => {
    const file = source("components/queue/DaqeDecisionModelSettings.tsx");
    expect(file).toContain('setDraftKey("")');
    // The draft is the only place the secret is held, and it is component state
    // rather than a persisted store.
    expect(file).toMatch(/useState\(""\)/);
  });

  it("shares one OpenRouter key between chat and decisions", () => {
    // One credential, one slot. A user who configured OpenRouter for chat models
    // should not be asked to paste the same key again for decisions.
    // The resolver moved into the shared client module when the connection test
    // was added, so that the picker and the queue status line cannot resolve an
    // endpoint differently.
    const file = source("components/queue/daqeDecisionClient.ts");
    expect(file).toContain('case OPENROUTER_DECISIONS_PROVIDER_ID:\n      return "openrouter"');
  });
});

describe("keychain provider allowlist", () => {
  const ai = readFileSync(join(root, "..", "src-tauri", "src", "commands", "ai.rs"), "utf8");

  it("has one allowlist, not one per command", () => {
    // Three commands used to carry three inline allowlists, which had already
    // drifted: `set` accepted deepseek while `get` and `remove` did not.
    expect(ai).toContain("const API_KEY_PROVIDERS");
    expect(ai).toContain("fn api_key_provider");
    expect(ai.match(/Unknown provider/g)?.length).toBe(1);
  });

  it("accepts the decision providers", () => {
    expect(ai).toContain('"jev"');
    expect(ai).toContain('"clef"');
  });

  it("does not duplicate openrouter for decisions", () => {
    // Slice from the const to its terminating `];`. Starting the search at the
    // declaration would stop at the `]` inside the `&[&str]` type annotation.
    const start = ai.indexOf("const API_KEY_PROVIDERS");
    const list = ai.slice(start, ai.indexOf("];", start));
    expect(list.match(/"openrouter"/g)?.length).toBe(1);
  });
});

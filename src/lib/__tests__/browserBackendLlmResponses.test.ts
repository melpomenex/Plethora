import { afterEach, describe, expect, it, vi } from "vitest";
import { browserInvoke } from "../browser-backend";
import fixtures from "../../api/llm/__tests__/fixtures/completions.json";
import { PinnedCloudProvider } from "../ai/providers/cloudProvider";
import { normalizeLLMResponse } from "../../api/llm/response";
import { askLibrary } from "../ai/tasks/definitions/libraryTask";

afterEach(() => vi.unstubAllGlobals());
describe("browser HTTP completion boundary", () => {
  for (const fixture of fixtures) {
    it(`makes one request and preserves ${fixture.name}`, async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(fixture.upstream), { status: 200 }));
      vi.stubGlobal("fetch", fetch);
      expect(
        await browserInvoke("llm_chat", {
          provider: "openai",
          model: "fixture",
          apiKey: "fixture",
          messages: [],
        })
      ).toEqual(fixture.canonical);
      expect(fetch).toHaveBeenCalledOnce();
    });
  }
  it("sends exactly one initial and one corrective HTTP request within the selected ceiling", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify(fixtures[3].upstream), { status: 200 })
      );
    vi.stubGlobal("fetch", fetch);
    const provider = new PinnedCloudProvider(
      {
        id: "http",
        name: "Fixture",
        provider: "openai",
        model: "fixture",
        enabled: true,
        apiKey: "fixture",
        maxTokens: 4096,
        contextWindowTokens: 16384,
        temperature: 0.2,
      },
      {
        chat: async (request) =>
          normalizeLLMResponse(
            await browserInvoke("llm_chat", request as unknown as Record<string, unknown>)
          ),
      }
    );
    await expect(
      askLibrary({
        query: "What are the main themes in my library?",
        provider,
        contextPassage: "Learning uses spaced review.",
        retrieve: async () => ({ results: [], mode: "semantic", candidatesScanned: 0 }),
      })
    ).rejects.toMatchObject({
      category: "InvalidStructuredOutput",
      completion: { attemptCount: 2, terminalFailureKind: "output-limit" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).max_tokens)).toEqual([
      4096, 4096,
    ]);
  });
});

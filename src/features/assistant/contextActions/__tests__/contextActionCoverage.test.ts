import { describe, expect, it, vi, beforeEach } from "vitest";
import { captureAction, type ActionId, type ActionTarget } from "../model";
import { resolveActionEnvelope } from "../execution";
import { runAssistantTurn } from "../../../../lib/ai/assistant/orchestrator";
import type { LLMProviderConfig } from "../../../../stores/llmProvidersStore";

const ALL_10_ACTIONS: ActionId[] = [
  "summarize",
  "explain",
  "quiz",
  "key-points",
  "key-terms",
  "translate",
  "outline-document",
  "example",
  "analyze-argument",
  "flashcards",
];

describe("Context Action Coverage on 2-Hour Video (all 10 actions)", () => {
  const providerConfig: LLMProviderConfig = {
    id: "or-1",
    provider: "openrouter",
    name: "OpenRouter",
    model: "anthropic/claude-3.5-sonnet",
    apiKey: "sk-test",
    enabled: true,
    temperature: 0.7,
    maxTokens: 4096,
  };

  const synthetic2HourTranscript = Array.from({ length: 1440 }, (_, i) => {
    const s = i * 5;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const ts = `[${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}]`;
    return `${ts} Lecture discussion point ${i + 1} exploring neurobiology of consciousness.`;
  }).join("\n");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Whole-source targets (kind: 'document')", () => {
    for (const actionId of ALL_10_ACTIONS) {
      it(`action '${actionId}' preserves whole-source full coverage without premature truncation`, async () => {
        const wholeDocTarget: ActionTarget = {
          key: "doc-target",
          owner: "document:vid-2h",
          kind: "document",
          sourceType: "video",
          documentId: "vid-2h",
          title: "Michael Pollan on Consciousness (2 Hours)",
          content: synthetic2HourTranscript,
          coverage: "full",
          labelKey: "document",
        };

        const action = captureAction(actionId, wholeDocTarget, "document");
        const resolved = await resolveActionEnvelope(action, "openrouter", providerConfig);

        expect(resolved.target.resolved).toBe(true);
        expect(resolved.target.coverage).toBe("full");
        expect(resolved.target.content).toBe(synthetic2HourTranscript);

        // Run turn with chatExecutor stub
        const chatExecutor = vi.fn(async () => ({
          content: `Response for action ${actionId} covering whole video.`,
        }));

        const result = await runAssistantTurn({
          action: resolved,
          scope: "document",
          userQuestion: actionId,
          sourceType: "video",
          sourceId: "vid-2h",
          sourceContent: resolved.target.content,
          sourceCoverage: resolved.target.coverage,
          completeTranscriptSource: true,
          explicitSourceContent: false,
          provider: "openrouter",
          model: providerConfig.model,
          chatExecutor,
        });

        expect(result.sourceCoverage).toMatch(/^(full|hierarchical-full)$/);
      });
    }
  });

  describe("Bounded selection targets (kind: 'selection')", () => {
    for (const actionId of ["explain", "summarize", "key-points", "translate"] as ActionId[]) {
      it(`action '${actionId}' preserves bounded window coverage for explicit text selection`, async () => {
        const selectionTarget: ActionTarget = {
          key: "sel-target",
          owner: "document:vid-2h",
          kind: "selection",
          sourceType: "video",
          documentId: "vid-2h",
          title: "Excerpt around 34:20",
          content: "[34:20] Only this specific paragraph discussing default mode network.",
          coverage: "window",
          labelKey: "selection",
        };

        const action = captureAction(actionId, selectionTarget, "document");
        const resolved = await resolveActionEnvelope(action, "openrouter", providerConfig);

        expect(resolved.target.coverage).toBe("window");

        const chatExecutor = vi.fn(async () => ({
          content: `Explanation of selected passage.`,
        }));

        const result = await runAssistantTurn({
          action: resolved,
          scope: "document",
          userQuestion: `Explain this selection`,
          sourceType: "video",
          sourceId: "vid-2h",
          sourceContent: resolved.target.content,
          sourceCoverage: "window",
          completeTranscriptSource: false,
          explicitSourceContent: true,
          selectionExcerpt: resolved.target.content,
          provider: "openrouter",
          model: providerConfig.model,
          chatExecutor,
        });

        expect(result.sourceCoverage).toBe("window");
      });
    }
  });
});

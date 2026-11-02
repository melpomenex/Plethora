import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAskLibrary } from "../useAskLibrary";
import { askLibrary } from "../tasks/definitions/libraryTask";
import { AIError } from "../errors";

vi.mock("../tasks/definitions/libraryTask", () => ({ askLibrary: vi.fn() }));
vi.mock("../../../components/assistant/ragConfig", () => ({
  resolveEmbeddingConfigForRag: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../resolveLibraryRag", () => ({
  resolveLibraryRagComposition: vi
    .fn()
    .mockResolvedValue({
      retrieverId: "ai_learning",
      generatorKind: "cloud",
      namespace: "library",
    }),
}));
beforeEach(() => {
  vi.mocked(askLibrary).mockReset();
});

it("keeps generation context and localized failure without a synthesized result", async () => {
  vi.mocked(askLibrary).mockRejectedValue(
    new AIError("InvalidStructuredOutput", "PRIVATE raw failure", {
      generation: { stage: "generation", evidenceCount: 2, retrievalMode: "semantic" },
      completion: {
        attemptCount: 2,
        firstFailureKind: "empty-response",
        terminalFailureKind: "empty-response",
      },
    })
  );
  const { result } = renderHook(useAskLibrary);
  await act(async () => result.current.ask("themes"));
  expect(result.current.error).toContain("Sources were found");
  expect(result.current.error).not.toContain("PRIVATE");
  expect(result.current.failure?.generation?.evidenceCount).toBe(2);
  expect(result.current.result).toBeNull();
  expect(result.current.running).toBe(false);
  act(() => result.current.reset());
  expect(result.current.failure).toBeNull();
});

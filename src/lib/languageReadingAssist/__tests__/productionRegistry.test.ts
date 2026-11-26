import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  hasCloudProvider: vi.fn(() => false),
  resolveAiPath: vi.fn<() => Promise<"ondevice" | "cloud" | "none">>(async () => "none"),
  isAnyAiAvailable: vi.fn(async () => false),
  runTask: vi.fn(),
}));

vi.mock("../../ai/provider", () => ({
  hasCloudProvider: aiMocks.hasCloudProvider,
  resolveAiPath: aiMocks.resolveAiPath,
  isAnyAiAvailable: aiMocks.isAnyAiAvailable,
}));

vi.mock("../../ai/tasks/runTask", () => ({
  runTask: aiMocks.runTask,
}));

import {
  createProductionReadingAssistRegistry,
  hasProductionReadingAssistProvider,
  isAnyProductionReadingAssistProviderAvailable,
} from "../productionRegistry";

describe("production reading-assist registry", () => {
  beforeEach(() => {
    aiMocks.hasCloudProvider.mockReturnValue(false);
    aiMocks.resolveAiPath.mockResolvedValue("none");
    aiMocks.isAnyAiAvailable.mockResolvedValue(false);
    aiMocks.runTask.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports local and AI availability truthfully", async () => {
    expect(hasProductionReadingAssistProvider()).toBe(true);
    expect(hasProductionReadingAssistProvider("ja")).toBe(true);
    expect(hasProductionReadingAssistProvider("zh-Hans")).toBe(true);
    expect(hasProductionReadingAssistProvider("ko")).toBe(true);
    expect(hasProductionReadingAssistProvider("ar")).toBe(true);
    expect(hasProductionReadingAssistProvider("es")).toBe(false);

    aiMocks.isAnyAiAvailable.mockResolvedValueOnce(true);
    await expect(isAnyProductionReadingAssistProviderAvailable("es")).resolves.toBe(true);

    aiMocks.hasCloudProvider.mockReturnValue(true);
    expect(hasProductionReadingAssistProvider("es")).toBe(true);
  });

  it("supports AI gloss via on-device AI and clamps/rejects invalid UTF-16 spans", async () => {
    aiMocks.resolveAiPath.mockResolvedValue("ondevice");
    aiMocks.isAnyAiAvailable.mockResolvedValue(true);

    const text = "😀Hola mundo"; // 😀 is 2 UTF-16 code units (indices 0..2)
    aiMocks.runTask.mockResolvedValue({
      output: {
        spans: [
          { start: 1, end: 6, annotation: "greeting" }, // start=1 lands inside surrogate pair -> snaps to 0..6 ("😀Hola")
          { start: -3, end: 6, annotation: "clamped-start" }, // clamps to 0..6
          { start: 7, end: 999, annotation: "world" }, // clamps to 7..11 ("mundo")
          { start: 500, end: 510, annotation: "out-of-bounds" }, // clamps to 11..11 -> dropped
          { start: -10, end: -2, annotation: "negative" }, // clamps to 0..0 -> dropped
          { start: 5, end: 2, annotation: "inverted" }, // end <= start -> dropped
          { start: 2, end: 2, annotation: "empty-range" }, // end <= start -> dropped
          { start: Number.NaN, end: 5, annotation: "nan" }, // dropped
          { start: 2, end: 6, annotation: "   " }, // empty annotation -> dropped
        ],
      },
    });

    const registry = createProductionReadingAssistRegistry();
    const result = await registry.run({
      sourceId: "doc-es",
      contentFingerprint: "fp-es",
      text,
      languageTag: "es",
      kind: "gloss",
    });

    expect(aiMocks.runTask).toHaveBeenCalledOnce();
    expect(result.status).toBe("ready");
    expect(result.spans).toHaveLength(3);

    expect(result.spans[0]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 6,
      sourceText: "😀Hola",
      annotation: "greeting",
    });
    expect(result.spans[1]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 6,
      sourceText: "😀Hola",
      annotation: "clamped-start",
    });
    expect(result.spans[2]).toMatchObject({
      sourceStart: 7,
      sourceEnd: text.length,
      sourceText: "mundo",
      annotation: "world",
    });
  });

  it("supports AI gloss via cloud AI and returns unsupported when no AI is available", async () => {
    const registry = createProductionReadingAssistRegistry();

    const noAiResult = await registry.run({
      sourceId: "doc-fr",
      contentFingerprint: "fp-fr",
      text: "Bonjour",
      languageTag: "fr",
      kind: "gloss",
    });
    expect(noAiResult.status).toBe("unsupported");
    expect(noAiResult.spans).toEqual([]);
    expect(aiMocks.runTask).not.toHaveBeenCalled();

    aiMocks.hasCloudProvider.mockReturnValue(true);
    aiMocks.resolveAiPath.mockResolvedValue("cloud");
    aiMocks.runTask.mockResolvedValue({
      output: { spans: [{ start: 0, end: 7, annotation: "hello" }] },
    });

    const cloudResult = await registry.run({
      sourceId: "doc-fr",
      contentFingerprint: "fp-fr-2",
      text: "Bonjour",
      languageTag: "fr",
      kind: "gloss",
    });
    expect(cloudResult.status).toBe("ready");
    expect(cloudResult.spans).toHaveLength(1);
    expect(cloudResult.spans[0]?.sourceText).toBe("Bonjour");
  });
});

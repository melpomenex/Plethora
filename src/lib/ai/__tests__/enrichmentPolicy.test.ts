import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORT_ENRICHMENT,
  ENRICHMENT_JOBS,
  filterAutomaticImportJobs,
  isAllowedOnAutomaticImport,
} from "../enrichmentPolicy";
import { runCheapImportEnrichment } from "../importEnrichment";
import { FakeLanguageIdProvider } from "../__fixtures__/FakePlatformProviders";

describe("enrichment policy", () => {
  it("classifies summarize and card generation as expensive", () => {
    expect(ENRICHMENT_JOBS.summarize).toBe("expensive");
    expect(ENRICHMENT_JOBS.generateCards).toBe("expensive");
    expect(isAllowedOnAutomaticImport("summarize")).toBe(false);
    expect(isAllowedOnAutomaticImport("languageId")).toBe(true);
  });

  it("does not enqueue expensive jobs on automatic import", async () => {
    const jobs = filterAutomaticImportJobs([
      "languageId",
      "parse",
      "index",
      "smartTagTier1",
      "smartTagTier2",
      "summarize",
      "generateCards",
    ]);
    expect(jobs).toEqual(["languageId", "parse", "index", "smartTagTier1"]);
    expect(jobs).toEqual([...DEFAULT_IMPORT_ENRICHMENT]);
    expect(jobs).not.toContain("summarize");
    expect(jobs).not.toContain("generateCards");

    const meta = await runCheapImportEnrichment("Hallo Welt", new FakeLanguageIdProvider("de"));
    expect(meta.language).toBe("de");
    expect(meta.jobs).not.toContain("summarize");
  });
});

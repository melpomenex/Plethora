import type { MarketingCompiledFixture } from "./types";

export interface MarketingCaptureQueryCounts {
  documents: number;
  extracts: number;
  learningItems: number;
  files: number;
  queue: number;
}

export interface MarketingCapturePersistencePort<TFile> {
  replace(records: {
    documents: MarketingCompiledFixture["records"]["documents"];
    extracts: MarketingCompiledFixture["records"]["extracts"];
    learningItems: MarketingCompiledFixture["records"]["learningItems"];
    files: TFile[];
    metadata: MarketingCompiledFixture["metadata"];
    auxiliary: Omit<MarketingCompiledFixture["records"], "documents" | "extracts" | "learningItems" | "files">;
  }): Promise<void>;
  readCounts(): Promise<MarketingCaptureQueryCounts>;
}

function expectedCounts(fixture: MarketingCompiledFixture): MarketingCaptureQueryCounts {
  return {
    documents: fixture.records.documents.length,
    extracts: fixture.records.extracts.length,
    learningItems: fixture.records.learningItems.length,
    files: fixture.records.files.length,
    queue: fixture.records.queue.length,
  };
}

export async function commitMarketingCaptureFixture<TFile>(
  fixture: MarketingCompiledFixture,
  files: TFile[],
  port: MarketingCapturePersistencePort<TFile>,
): Promise<MarketingCaptureQueryCounts> {
  if (
    fixture.metadata.schemaVersion !== 2 ||
    fixture.metadata.fixtureId !== "marketing-fixture-v2" ||
    fixture.metadata.fixtureVersion !== "2.0.0" ||
    !/^[0-9a-f]{64}$/.test(fixture.metadata.fixtureHash)
  ) {
    throw new Error("Unsupported or corrupt marketing fixture metadata");
  }
  if (files.length !== fixture.records.files.length) {
    throw new Error("Decoded fixture file count does not match compiled metadata");
  }
  const { documents, extracts, learningItems, files: _compiledFiles, ...auxiliary } = fixture.records;
  await port.replace({ documents, extracts, learningItems, files, metadata: fixture.metadata, auxiliary });
  const actual = await port.readCounts();
  const expected = expectedCounts(fixture);
  for (const key of Object.keys(expected) as Array<keyof MarketingCaptureQueryCounts>) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Marketing fixture query mismatch for ${key}: expected ${expected[key]}, received ${actual[key]}`);
    }
  }
  return actual;
}

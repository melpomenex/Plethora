import {
  anchorForEpub,
  anchorForPdf,
  anchorForTranscript,
  anchorForText,
  lexiconRecords,
  searchTokens,
  sourceTextForSpan,
} from "../contracts";
import { baselineAdapter } from "../baseline";

describe("language processing consumer contracts", () => {
  it("keeps reader/source anchors provider-independent", async () => {
    const epub = anchorForEpub("book", "epubcfi(/6/2!/4/2/1:0,4:3)");
    const pdf = anchorForPdf("book", 4, 10, 12);
    const transcript = anchorForTranscript("audio", "segment-1", 100, 300);
    expect(epub.sourceType).toBe("epub");
    expect(pdf.locator?.page).toBe(4);
    expect(transcript.sourceId).toBe("segment-1");
    expect(anchorForText("note", "fp", "markdown").sourceType).toBe("markdown");
    const result = await baselineAdapter.analyze({ text: "Read this.", languageTag: "en", sourceAnchor: epub });
    const token = result.tokens.find((item) => item.surface === "Read")!;
    expect(sourceTextForSpan("Read this.", token)).toBe("Read");
    expect(lexiconRecords(result, "en" as never)).toHaveLength(2);
    expect(searchTokens(result.tokens, { processingKey: result.version.processingKey, normalized: "read" })).toHaveLength(1);
  });
});

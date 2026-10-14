import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const documentViewerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../DocumentViewer.tsx"),
  "utf8",
);

describe("DocumentViewer volume rocker media playback guard", () => {
  it("passes active media state to the rocker handler only for hardware volume keys", () => {
    expect(documentViewerSource).toContain(
      'import { hasActiveMediaPlayback } from "../../utils/mediaPlayback";',
    );
    expect(documentViewerSource).toMatch(
      /mediaPlaybackActive:\s*\(e\.key === "VolumeUp" \|\| e\.key === "VolumeDown"\)\s*&&\s*hasActiveMediaPlayback\(\)/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { createVideoLanguageSession, currentVideoSentence, leaveVideoLanguageMode, selectVideoSentence, setVideoLanguageMode } from "../index";

describe("video language session", () => {
  const sentences = [{ id: "s1", text: "One", startMs: 0, endMs: 100, tokens: [] }, { id: "s2", text: "Two", startMs: 100, endMs: 200, tokens: [] }] as const;

  it("keeps normal playback boundary and seeks only transcript sentences", () => {
    const session = createVideoLanguageSession({ sessionId: "v1", videoId: "yt", sourceFingerprint: "v1", sentences, subtitleMode: "target", layout: "desktop", normalMode: false, autoPause: true, loopCurrent: false, startedAt: 1 });
    expect(currentVideoSentence(selectVideoSentence(session, "s2"))?.text).toBe("Two");
    expect(leaveVideoLanguageMode(session).normalMode).toBe(true);
  });

  it("keeps subtitle/layout changes local to language mode", () => {
    const session = createVideoLanguageSession({ sessionId: "v1", videoId: "yt", sourceFingerprint: "v1", sentences, subtitleMode: "target", layout: "desktop", normalMode: false, autoPause: true, loopCurrent: false, startedAt: 1 });
    const next = setVideoLanguageMode(session, { subtitleMode: "dual", layout: "mobile", loopCurrent: true });
    expect(next.subtitleMode).toBe("dual");
    expect(next.loopCurrent).toBe(true);
    expect(session.subtitleMode).toBe("target");
  });
});

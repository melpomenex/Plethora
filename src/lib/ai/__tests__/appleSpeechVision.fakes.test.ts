import { describe, expect, it } from "vitest";
import { FakeSpeechProvider, FakeVisionProvider } from "../providers/fakes";

describe("FakeSpeechProvider", () => {
  it("replays fixture audio as timestamped segments", async () => {
    const fake = new FakeSpeechProvider([
      {
        text: "hello world",
        segments: [
          { id: "s0", text: "hello", startMs: 0, endMs: 400 },
          { id: "s1", text: "world", startMs: 400, endMs: 900 },
        ],
      },
    ]);
    await expect(fake.transcribeFile()).resolves.toMatchObject({
      text: "hello world",
      segments: [
        { startMs: 0, endMs: 400 },
        { startMs: 400, endMs: 900 },
      ],
    });
  });
});

describe("FakeVisionProvider", () => {
  it("maps unknown blocks as plain text", async () => {
    const fake = new FakeVisionProvider({
      text: "Title\n- item",
      html: "<h1>Title</h1><ul><li>item</li></ul>",
      blocks: [{ id: "b1", text: "Title" }],
    });
    await expect(fake.recognizeDocument()).resolves.toMatchObject({ text: "Title\n- item" });
  });
});

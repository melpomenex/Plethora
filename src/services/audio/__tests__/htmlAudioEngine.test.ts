import { expect, it, vi } from "vitest";
import { HtmlAudioEngine, type AudioEngineEvents } from "../htmlAudioEngine";

class MediaElement extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  duration = 120;
  playbackRate = 1;
  volume = 1;
  paused = true;
  ended = false;
  error = null;
  readyState = 0;
  seekable = { length: 1 };
  load = vi.fn();
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
}
const part = { partId: "part", sourceRevision: "v1", browserUrl: "/test.mp3", durationSec: 120, globalStartSec: 0 };
const handlers = (): AudioEngineEvents => ({ sample: vi.fn(), buffering: vi.fn(), ended: vi.fn(), error: vi.fn() });

it("uses one injected element, waits for metadata and releases old listeners on replacement", async () => {
  const element = new MediaElement();
  const factory = vi.fn(() => element as unknown as HTMLAudioElement);
  const engine = new HtmlAudioEngine(factory);
  const first = handlers();
  const load = engine.load(part, first, new AbortController().signal);
  element.dispatchEvent(new Event("loadedmetadata"));
  await load;
  engine.seek(30);
  expect(engine.sample().timeInPart).toBe(30);
  const second = handlers();
  element.readyState = 1;
  await engine.load({ ...part, partId: "second", browserUrl: "/next.mp3" }, second, new AbortController().signal);
  element.dispatchEvent(new Event("timeupdate"));
  expect(first.sample).not.toHaveBeenCalled();
  expect(second.sample).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
  engine.dispose();
  element.dispatchEvent(new Event("timeupdate"));
  expect(second.sample).toHaveBeenCalledTimes(1);
  expect(element.src).toBe("");
});

it("rejects cancelled metadata loads and ignores stale queued end events", async () => {
  const element = new MediaElement();
  const engine = new HtmlAudioEngine(() => element as unknown as HTMLAudioElement);
  const abort = new AbortController();
  const result = expect(engine.load(part, handlers(), abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await result;
  element.readyState = 1;
  const current = handlers();
  await engine.load(part, current, new AbortController().signal);
  element.ended = false;
  element.dispatchEvent(new Event("ended"));
  expect(current.ended).not.toHaveBeenCalled();
  element.ended = true;
  element.dispatchEvent(new Event("ended"));
  expect(current.ended).toHaveBeenCalledTimes(1);
  engine.dispose();
});

it("classifies decode, network, expired remote URL, and unsupported codec MediaError codes", async () => {
  const element = new MediaElement() as MediaElement & { canPlayType?: (mime: string) => string };
  element.canPlayType = (mime: string) => (mime === "audio/mpeg" ? "probably" : "");
  const engine = new HtmlAudioEngine(() => element as unknown as HTMLAudioElement);

  const remoteExpired = engine.load(
    { ...part, browserUrl: "https://cdn.podcast.example/ep.mp3?sig=expired" },
    handlers(),
    new AbortController().signal,
  );
  (element as unknown as { error: { code: number; message: string } }).error = { code: 4, message: "403 Forbidden" };
  element.dispatchEvent(new Event("error"));
  await expect(remoteExpired).rejects.toMatchObject({ code: "expired_url" });

  const unsupportedCodec = engine.load(
    { ...part, browserUrl: "http://127.0.0.1:4123/stream/book.wma" },
    handlers(),
    new AbortController().signal,
  );
  (element as unknown as { error: { code: number; message: string } }).error = { code: 4, message: "Not supported" };
  element.dispatchEvent(new Event("error"));
  await expect(unsupportedCodec).rejects.toMatchObject({ code: "unsupported_codec" });

  const networkError = engine.load(part, handlers(), new AbortController().signal);
  (element as unknown as { error: { code: number; message: string } }).error = { code: 2, message: "Connection reset" };
  element.dispatchEvent(new Event("error"));
  await expect(networkError).rejects.toMatchObject({ code: "network" });
  engine.dispose();
});

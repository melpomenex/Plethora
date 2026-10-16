import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDictationAdapter } from "../webDictation";
class Recognition {
  static current: Recognition;
  lang = ""; interimResults = false; continuous = false;
  onstart: (() => void) | null = null; onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  start = vi.fn(() => this.onstart?.()); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.current = this; }
}
const args = { sessionId: "one", locale: "en-US", requireOnDevice: false, networkConsent: true };
beforeEach(() => { vi.stubGlobal("SpeechRecognition", Recognition); vi.stubGlobal("isSecureContext", true); Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } }); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("disclosed browser speech fallback", () => {
  it("status does not prompt or construct capture", async () => {
    const adapter = new BrowserDictationAdapter(); expect((await adapter.status("en-US")).available).toBe(true); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it("rejects strict local and declined consent without recording", async () => {
    const adapter = new BrowserDictationAdapter(); await expect(adapter.start({ ...args, requireOnDevice: true })).rejects.toThrow("unavailable"); await expect(adapter.start({ ...args, networkConsent: false })).rejects.toThrow("unavailable");
  });
  it("deduplicates repeated final indexes and never inserts interim text", async () => {
    const adapter = new BrowserDictationAdapter(); await adapter.start(args); const recognition = Recognition.current;
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "interim" } }] });
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "final" } }] });
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "final" } }] });
    const result = adapter.stop("one"); recognition.onend?.(); expect(await result).toEqual({ text: "final" }); await adapter.cancel("one");
  });
  it("cancellation invalidates late results and callbacks", async () => {
    const adapter = new BrowserDictationAdapter(); await adapter.start(args); const recognition = Recognition.current; const late = recognition.onresult;
    await adapter.cancel("one"); late?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late" } }] });
    await expect(adapter.stop("one")).rejects.toThrow("cancelled"); expect(recognition.abort).toHaveBeenCalledOnce();
  });
});

import type { DictationAdapter, DictationCapability, DictationResult, DictationStart } from "./contracts";
import { DICTATION_LIMITS } from "./contracts";
interface RecognitionResult { isFinal: boolean; 0?: { transcript?: string } }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionConstructor = new () => Recognition;
function constructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
interface WebSession {
  id: string; recognition: Recognition; results: Map<number, string>; ended: boolean; error?: string;
  startReject: (error: Error) => void; waiting?: { resolve: (result: DictationResult) => void; reject: (error: Error) => void };
  timer?: ReturnType<typeof setTimeout>;
}
export class BrowserDictationAdapter implements DictationAdapter {
  private session: WebSession | undefined;
  async status(locale: string): Promise<DictationCapability> {
    return { platform: "web", available: Boolean(window.isSecureContext && constructor() && navigator.mediaDevices?.getUserMedia),
      locale, processing: "unknown", microphonePermission: "unknown",
      reason: "Browser speech may send audio to its recognition service. You can always type or use keyboard dictation." };
  }
  start(options: DictationStart): Promise<void> {
    if (this.session) return Promise.reject(new Error("busy"));
    const Ctor = constructor();
    if (!Ctor || !window.isSecureContext || options.requireOnDevice || !options.networkConsent) return Promise.reject(new Error("unavailable"));
    return new Promise((resolve, reject) => {
      const recognition = new Ctor();
      const session: WebSession = { id: options.sessionId, recognition, results: new Map(), ended: false, startReject: reject };
      this.session = session;
      recognition.lang = options.locale; recognition.interimResults = true; recognition.continuous = false;
      recognition.onstart = () => { if (this.session !== session) return; resolve(); session.timer = setTimeout(() => recognition.stop(), DICTATION_LIMITS.captureMs); };
      recognition.onresult = event => {
        if (this.session !== session || session.ended) return;
        for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) session.results.set(i, event.results[i][0]?.transcript ?? "");
      };
      recognition.onerror = event => {
        if (this.session !== session) return;
        session.error = event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : event.error === "no-speech" ? "no-speech" : "unavailable";
        reject(new Error(session.error));
        this.finish(session);
      };
      recognition.onend = () => { if (this.session === session) { this.finish(session); } };
      try { recognition.start(); } catch (error) { this.session = undefined; reject(error); }
    });
  }
  private finish(session: WebSession) {
    session.ended = true; clearTimeout(session.timer);
    if (!session.waiting) { session.timer = setTimeout(() => { if (this.session === session) void this.cancel(session.id); }, 30_000); return; }
    const { resolve, reject } = session.waiting;
    session.waiting = undefined;
    const text = [...session.results.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join(" ").trim();
    if (session.error || !text) reject(new Error(session.error ?? "no-speech")); else resolve({ text });
  }
  stop(id: string): Promise<DictationResult> {
    const session = this.session;
    if (!session || session.id !== id) return Promise.reject(new Error("cancelled"));
    if (session.waiting) return Promise.reject(new Error("busy"));
    return new Promise((resolve, reject) => {
      session.waiting = { resolve, reject };
      if (session.ended) this.finish(session);
      else { try { session.recognition.stop(); } catch { reject(new Error("unavailable")); } }
    });
  }
  async cancel(id: string) {
    const session = this.session;
    if (!session || session.id !== id) return;
    this.session = undefined; clearTimeout(session.timer);
    session.startReject(new Error("cancelled")); session.waiting?.reject(new Error("cancelled"));
    session.recognition.onresult = null; session.recognition.onerror = null; session.recognition.onend = null; session.recognition.onstart = null;
    try { session.recognition.abort(); } catch { /* Already released. */ }
  }
}

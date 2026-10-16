import { invokeCommand, isTauri, nativePlatform } from "../tauri";
import { acquireAudioCapture } from "./captureOwner";
import { ANDROID_DICTATION_COMMANDS, DICTATION_LIMITS, type DictationAdapter, type DictationCapability, type DictationResult, type DictationStart } from "./contracts";
import { BrowserDictationAdapter } from "./webDictation";

export class DictationError extends Error {
  constructor(public readonly code: string, message = code) { super(message); }
}
export function createDictationAdapter(platform = nativePlatform()?.toLowerCase(), native = isTauri(), invoke = invokeCommand): DictationAdapter {
  if (platform === "android") return {
    status: locale => invoke(ANDROID_DICTATION_COMMANDS.status, { request: { locale } }),
    start: async options => { await invoke(ANDROID_DICTATION_COMMANDS.start, { request: options }); },
    stop: sessionId => invoke(ANDROID_DICTATION_COMMANDS.stop, { request: { sessionId } }),
    cancel: async sessionId => { await invoke(ANDROID_DICTATION_COMMANDS.cancel, { request: { sessionId } }); },
  };
  if (platform === "ios") {
    const command = (name: string) => `plugin:plethora-apple-intelligence|apple_speech_${name}`;
    const payload = (options: object) => ({ payload: { ...options, purpose: "composer-dictation" } });
    return {
      status: locale => invoke(command("dictation_status"), payload({ locale })),
      start: async options => { await invoke(command("start_live"), payload(options)); },
      stop: sessionId => invoke(command("stop_live"), payload({ sessionId })),
      cancel: async sessionId => { await invoke(command("cancel"), payload({ sessionId })); },
    };
  }
  if (!native) return new BrowserDictationAdapter();
  return {
    status: async locale => ({ platform: "unsupported", available: false, processing: "unknown", microphonePermission: "unknown", locale, reason: "Native dictation is unavailable. Type or use your keyboard's dictation." }),
    start: async () => { throw new DictationError("unavailable"); }, stop: async () => { throw new DictationError("unavailable"); }, cancel: async () => {},
  };
}
function deadline<T>(operation: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DictationError("timeout")), timeout);
    operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
interface Capture { id: string; adapter: DictationAdapter; release: () => void; stopped?: Promise<DictationResult> }
export class DictationCoordinator {
  private owner: Capture | undefined;
  async start(adapter: DictationAdapter, options: DictationStart, capability: DictationCapability) {
    if (this.owner) throw new DictationError("busy");
    if (!capability.available || (capability.processing !== "on-device" && (options.requireOnDevice || !options.networkConsent))) throw new DictationError("unavailable");
    const release = acquireAudioCapture();
    const owner: Capture = { id: options.sessionId, adapter, release }; this.owner = owner;
    try {
      await deadline(adapter.start(options), DICTATION_LIMITS.initializationMs);
      if (this.owner !== owner) { void adapter.cancel(owner.id); throw new DictationError("cancelled"); }
    } catch (error) {
      if (this.owner === owner) void this.cancel(owner.id);
      throw error;
    }
  }
  stop(id: string): Promise<DictationResult> {
    const owner = this.owner;
    if (!owner || owner.id !== id) return Promise.reject(new DictationError("cancelled"));
    owner.stopped ??= deadline(owner.adapter.stop(id), DICTATION_LIMITS.finalizationMs).then(result => {
      if (this.owner !== owner) throw new DictationError("cancelled");
      if (!result.text.trim()) throw new DictationError("no-speech");
      return result;
    }).finally(async () => {
      if (this.owner === owner) { this.owner = undefined; await deadline(owner.adapter.cancel(id), DICTATION_LIMITS.finalizationMs).catch(() => {}); owner.release(); }
    });
    return owner.stopped;
  }
  async cancel(id: string) {
    const owner = this.owner;
    if (!owner || owner.id !== id) return;
    this.owner = undefined;
    try { await deadline(owner.adapter.cancel(id), DICTATION_LIMITS.finalizationMs); } catch { /* Cancellation never replaces draft text. */ }
    finally { owner.release(); }
  }
}
export const dictationCoordinator = new DictationCoordinator();

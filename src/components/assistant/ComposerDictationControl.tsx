import { Microphone, Stop } from "@phosphor-icons/react";
import { Dialog } from "../md3/Dialog";
import type { ComposerDictation } from "../../hooks/useComposerDictation";
export function ComposerDictationControl({ dictation }: { dictation: ComposerDictation }) {
  const busy = dictation.phase !== "idle";
  return <div className="flex items-center gap-2">
    <button type="button" className="min-h-12 min-w-12 rounded-full md-state text-primary focus-visible:outline focus-visible:outline-2" disabled={!busy && dictation.disabled}
      aria-label={busy ? "Stop dictation" : "Voice input — dictate question"} aria-pressed={busy}
      onClick={() => { if (dictation.phase === "starting") dictation.cancel(); else if (busy) void dictation.stop(); else void dictation.start(); }}>
      {busy ? <Stop size={20} aria-hidden="true" /> : <Microphone size={20} aria-hidden="true" />}
    </button>
    <span className="text-xs text-muted-foreground" role="status">{dictation.error ?? (busy ? (dictation.phase === "starting" ? "Starting microphone…" : dictation.phase === "stopping" ? "Finalizing dictation…" : "Listening. Stop to insert text.") : dictation.disabled ? "Type or use your keyboard’s dictation." : "")}</span>
    <Dialog open={dictation.needsConsent} onClose={dictation.cancel} title="Speech processing" footer={<button type="button" className="min-h-12 px-4 rounded-full bg-primary text-primary-foreground md-state" onClick={() => void dictation.start(true)}>Continue with speech service</button>}>
      <p>Your system or browser speech service may send audio off this device for recognition. Continue only if you agree. You can also type or use keyboard dictation.</p>
    </Dialog>
  </div>;
}

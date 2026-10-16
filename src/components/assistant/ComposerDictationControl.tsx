import { Microphone, Stop } from "@phosphor-icons/react";
import { Dialog } from "../md3/Dialog";
import { cn } from "../../utils/cn";
import type { ComposerDictation } from "../../hooks/useComposerDictation";

function dictationStatusText(dictation: ComposerDictation): string {
  return dictation.error ?? (dictation.phase === "starting"
    ? "Starting microphone…"
    : dictation.phase === "stopping"
      ? "Finalizing dictation…"
      : dictation.phase === "listening"
        ? "Listening. Stop to insert text."
        : dictation.disabled
          ? "Type or use your keyboard’s dictation."
          : "");
}

function DictationTrigger({ dictation, className }: { dictation: ComposerDictation; className?: string }) {
  const busy = dictation.phase !== "idle";
  return <button type="button" className={cn("min-h-12 min-w-12 rounded-full md-state text-primary focus-visible:outline focus-visible:outline-2", className)} disabled={!busy && dictation.disabled}
    aria-label={busy ? "Stop dictation" : "Voice input — dictate question"} aria-pressed={busy}
    onClick={() => { if (dictation.phase === "starting") dictation.cancel(); else if (busy) void dictation.stop(); else void dictation.start(); }}>
    {busy ? <Stop size={20} aria-hidden="true" /> : <Microphone size={20} aria-hidden="true" />}
  </button>;
}

function DictationConsentDialog({ dictation }: { dictation: ComposerDictation }) {
  return <Dialog open={dictation.needsConsent} onClose={dictation.cancel} title="Speech processing" footer={<button type="button" className="min-h-12 px-4 rounded-full bg-primary text-primary-foreground md-state" onClick={() => void dictation.start(true)}>Continue with speech service</button>}>
    <p>Your system or browser speech service may send audio off this device for recognition. Continue only if you agree. You can also type or use keyboard dictation.</p>
  </Dialog>;
}

/** Row variant (selection Ask): trigger, visible status text, consent dialog. */
export function ComposerDictationControl({ dictation }: { dictation: ComposerDictation }) {
  return <div className="flex items-center gap-2">
    <DictationTrigger dictation={dictation} />
    <span className="text-xs text-muted-foreground" role="status">{dictationStatusText(dictation)}</span>
    <DictationConsentDialog dictation={dictation} />
  </div>;
}

/**
 * Bar variant (mobile composer): the trigger alone renders inside the input
 * row; status and errors are announced through a visually hidden live region
 * instead of a permanent status row.
 */
export function ComposerDictationButton({ dictation, className }: { dictation: ComposerDictation; className?: string }) {
  return <>
    <DictationTrigger dictation={dictation} className={className} />
    <span className="sr-only" role="status" aria-live="polite">{dictationStatusText(dictation)}</span>
    <DictationConsentDialog dictation={dictation} />
  </>;
}

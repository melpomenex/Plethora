import { SpeakerHigh, Gear } from "@phosphor-icons/react";
import { listAdapters } from "../../api/tts/registry";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSystemVoices } from "../../hooks/useSystemVoices";
import { isTauri, isNativeMobile } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";

export function TTSSetupSheet({ onClose, onStart }: { onClose: () => void; onStart?: () => void }) {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const { available } = useSystemVoices();
  const adapters = listAdapters().filter((a) => {
    if (a.id === "pocket") return isTauri() && !isNativeMobile();
    if (a.id === "android") return isNativeMobile();
    return true;
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-xl bg-card p-5" onClick={(e)=>e.stopPropagation()}>
        <h3 className="text-base font-semibold">Listen — Choose how Plethora should read this document</h3>
        <div className="mt-4 space-y-2">
          {available && (
            <button onClick={() => { updateSettings({ tts: { ...settings.tts, enabled: true, provider: "system" } }); onClose(); onStart?.(); }} className="flex w-full items-center gap-3 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left">
              <SpeakerHigh className="h-5 w-5 text-primary" /><span className="font-medium">Use System Voice</span><span className="ml-auto text-xs text-muted-foreground">One tap</span>
            </button>
          )}
          {adapters.filter(a=>a.id!=="system").map((a)=>(
            <button key={a.id} onClick={()=>{ window.location.hash="#settings/tts"; onClose(); }} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left opacity-70">
              <span className="font-medium">{a.label}</span><span className="ml-auto text-xs text-amber-600">Needs API key</span>
            </button>
          ))}
          <button onClick={()=>{ window.location.hash="#settings/tts"; onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Gear className="h-4 w-4" />Configure more…</button>
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-lg bg-muted px-3 py-2 text-sm">Close</button>
      </div>
    </div>
  );
}

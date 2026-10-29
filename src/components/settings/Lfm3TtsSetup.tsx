import { useEffect, useState } from "react";
import { getLfm3Status, type Lfm3Status } from "../../api/lfm3Tts";
import { useHfModelStore } from "../../stores/useHfModelStore";
import { LFM3_MODEL_ID } from "../../utils/lfm3Tts";
import { SettingsSearchTarget, useOptionalSettingsSearchNavigation } from "./search/SettingsSearchNavigation";

export function Lfm3TtsSetup() {
  const navigation = useOptionalSettingsSearchNavigation();
  const [status, setStatus] = useState<Lfm3Status | null>(null);
  const installed = useHfModelStore((s) =>
    s.installedModels.some((m) => m.id === LFM3_MODEL_ID && m.installed)
  );
  useEffect(() => {
    let active = true;
    void getLfm3Status()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active)
          setStatus({
            available: false,
            loaded: false,
            modelId: null,
            backend: null,
            error: "LFM3 runtime is unavailable in this app build.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <SettingsSearchTarget id="tts.lfm3.model" label="Local LFM3 model" className="space-y-2">
      <p className="text-sm font-medium">Local LFM3 model</p>
      <p className="text-sm text-muted-foreground" role="status">
        {!status
          ? "Checking local runtime…"
          : !status.available
            ? status.error || "LFM3 runtime is unavailable in this app build."
            : installed
              ? "Model installed. Ready for offline speech on this device."
              : "Download the optional model (about 1.4 GB) to use LFM3 offline."}
      </p>
      {status?.available && (
        <button
          type="button"
          onClick={() => navigation?.revealTarget("tts.localModels")}
          className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {installed ? "Manage model" : "Get model"}
        </button>
      )}
    </SettingsSearchTarget>
  );
}

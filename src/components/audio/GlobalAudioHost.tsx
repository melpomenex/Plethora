import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri } from "../../lib/tauri";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "../../services/audio/audioPlaybackRollout";
const RemoteBridge = lazy(() => import("./GlobalAudioDesktopBridge").then(module => ({ default: module.GlobalAudioDesktopBridge })));

export async function isPrimaryAudioWindow(): Promise<boolean> {
  if (/^#\/(auth\/|screenshot-overlay)/.test(window.location.hash)) return false;
  if (!isTauri()) return true;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label === "main";
}

/** Lifetime anchor above routing. Responsive shell/player surfaces cannot dispose its engine. */
export function GlobalAudioHost({ enabled = GLOBAL_AUDIO_PLAYBACK_ENABLED }: { enabled?: boolean } = {}) {
  const [primary, setPrimary] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setPrimary(false);
      return;
    }
    let mounted = true;
    let initialized = false;
    const sync = () => {
      void isPrimaryAudioWindow().then(async allowed => {
        if (!mounted) return;
        if (!allowed) {
          initialized = false;
          setPrimary(false);
          return;
        }
        if (initialized) return;
        initialized = true;
        const { getGlobalAudioController, initializeAudioApplication } = await import("../../services/audio/audioRuntime");
        if (!mounted) return;
        getGlobalAudioController().initialize();
        await initializeAudioApplication();
        if (mounted) setPrimary(true);
      });
    };
    sync();
    window.addEventListener("hashchange", sync);
    // StrictMode cleanup/view changes release this mount, never the application owner.
    return () => {
      mounted = false;
      window.removeEventListener("hashchange", sync);
    };
  }, [enabled]);
  return primary ? <Suspense fallback={null}><RemoteBridge /></Suspense> : null;
}

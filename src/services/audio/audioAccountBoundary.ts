import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "./audioPlaybackRollout";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";

/** Account mutation waits for progress and service teardown; failure leaves the old namespace active. */
export async function prepareAudioAccountChange(): Promise<void> {
  if (!GLOBAL_AUDIO_PLAYBACK_ENABLED) return;
  const { getGlobalAudioController } = await import("./audioRuntime");
  await getGlobalAudioController().stopAndClose();
  useAudioPlaybackStore.setState({
    snapshot: null,
    expanded: false,
    storageError: null,
    checkpointError: null,
    sessionError: null,
    controlError: null,
    adapterError: null,
  });
}

/** Hydrate the newly active account/local profile paused without leaking prior profile state. */
export async function completeAudioAccountChange(userId: string | null): Promise<void> {
  if (!GLOBAL_AUDIO_PLAYBACK_ENABLED) return;
  const { restoreAudioProfilePaused } = await import("./audioRuntime");
  await restoreAudioProfilePaused(userId ? `account:${userId}` : "local").catch(error => {
    useAudioPlaybackStore.setState({ controlError: String(error) });
  });
}

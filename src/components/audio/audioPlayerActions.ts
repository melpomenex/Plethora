import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import type { AudioPlaybackOwner } from "../../services/audio/audioPlaybackOwner";

export async function runAudioAction(action: (owner: AudioPlaybackOwner) => void | Promise<void>): Promise<boolean> {
  try {
    const { getGlobalAudioController } = await import("../../services/audio/audioRuntime");
    await action(getGlobalAudioController());
    useAudioPlaybackStore.setState({ controlError: null });
    return true;
  } catch (error) {
    useAudioPlaybackStore.setState({ controlError: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function audioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

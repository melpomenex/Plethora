import type { AudioCheckpoint, AudioSourceKey, SavedAudioSession, SavedAudioSessionRecord } from "../types/audioEdition";
import { invokeCommand, isTauri } from "../lib/tauri";
import { validateAudioCheckpoint, validateSavedAudioSession } from "../services/audio/audioCheckpointValidation";

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invokeCommand<T>(command, args);
  const { browserInvoke } = await import("../lib/browser-backend");
  return browserInvoke<T>(command, args);
}

export const getAudioCheckpoint = (sourceKey: AudioSourceKey): Promise<AudioCheckpoint | null> => call("get_audio_checkpoint", { sourceKey });
export const getAudioSession = (profileKey: string): Promise<SavedAudioSessionRecord | null> => call("get_audio_session", { profileKey });

/** Profile-scoped claims are explicit and CAS guarded; checkpoint delivery never steals ownership. */
export class AudioPlaybackRepository {
  private claims = new Map<string, Promise<void>>();

  ensureOwner(profileKey: string, ownerEpoch: string): Promise<void> {
    const key = JSON.stringify([profileKey, ownerEpoch]);
    let claim = this.claims.get(key);
    if (!claim) {
      claim = this.claim(profileKey, ownerEpoch).catch(error => { this.claims.delete(key); throw error; });
      this.claims.set(key, claim);
    }
    return claim;
  }

  private async claim(profileKey: string, ownerEpoch: string): Promise<void> {
    const current = await getAudioSession(profileKey);
    const accepted = await call<boolean>("claim_audio_owner", { profileKey, ownerEpoch, previousOwnerEpoch: current?.ownerEpoch ?? null });
    if (!accepted) throw new Error("Audio owner changed while reconnecting");
  }

  commit = async (checkpoint: AudioCheckpoint): Promise<void> => {
    validateAudioCheckpoint(checkpoint);
    await this.ensureOwner(checkpoint.sourceKey.profileKey, checkpoint.ownerEpoch);
    const disposition = await call<"accepted" | "duplicate" | "stale">("commit_audio_checkpoint", { checkpoint });
    if (disposition !== "accepted" && disposition !== "duplicate") throw new Error("Audio checkpoint owner is stale");
    await mirrorAudioEditionCheckpoint(checkpoint);
  };

  async saveSession(profileKey: string, ownerEpoch: string, session: SavedAudioSession): Promise<void> {
    validateSavedAudioSession(session, profileKey);
    await this.ensureOwner(profileKey, ownerEpoch);
    if (!await call<boolean>("save_audio_session", { profileKey, ownerEpoch, session })) throw new Error("Audio session owner is stale");
  }
}

/** Native imports already own SQLite; mirroring must never claim JavaScript checkpoint authority. */
export async function mirrorAudioEditionCheckpoint(checkpoint: AudioCheckpoint): Promise<void> {
    if (checkpoint.sourceKey.kind === "audio_edition" && checkpoint.positionSec !== null) {
      const [{ getAudioEdition }, { saveAudioEditionPosition, getAudioEditionPosition }] = await Promise.all([import("./audioEditions"), import("../utils/audioEditionPosition")]);
      const edition = await getAudioEdition(checkpoint.sourceKey.sourceId);
      if (edition) {
        await saveAudioEditionPosition({ editionId: edition.id, documentId: edition.sourceDocumentId, partIndex: checkpoint.partIndex, timeInPart: checkpoint.timeInPart, globalTimeSec: checkpoint.positionSec, totalDurationSec: checkpoint.durationSec ?? 0, updatedAt: checkpoint.updatedAt }, true);
        const saved = await getAudioEditionPosition(edition.id, edition.sourceDocumentId);
        if (!saved || saved.updatedAt < checkpoint.updatedAt || saved.partIndex !== checkpoint.partIndex || saved.timeInPart !== checkpoint.timeInPart) throw new Error("Audio Edition compatibility position remains unsaved");
      }
    }
}

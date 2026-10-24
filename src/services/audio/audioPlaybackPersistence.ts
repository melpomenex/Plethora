import type { AudioCheckpoint, AudioSourceKey } from "../../types/audioEdition";
import { CoalescingAudioWriter } from "./coalescingAudioWriter";

export const audioSourceId = (key: AudioSourceKey): string => JSON.stringify([key.profileKey, key.kind, key.sourceId]);

export interface AudioCheckpointWriter {
  commit: (checkpoint: AudioCheckpoint) => Promise<void>;
  onError?: (error: unknown) => void;
  onSaved?: () => void;
}

/** One in-flight commit plus the latest dirty checkpoint per identity. */
export class AudioPlaybackPersistence extends CoalescingAudioWriter<AudioCheckpoint> {
  private acknowledged: Map<string, { epoch: string; sequence: number }>;
  constructor(writer: AudioCheckpointWriter) {
    const acknowledged = new Map<string, { epoch: string; sequence: number }>();
    super({
      ...writer,
      commit: async value => {
        await writer.commit(value);
        acknowledged.set(audioSourceId(value.sourceKey), { epoch: value.ownerEpoch, sequence: value.checkpointSequence });
        if (acknowledged.size > 128) acknowledged.delete(acknowledged.keys().next().value!);
      },
      key: value => audioSourceId(value.sourceKey),
      fingerprint: value => JSON.stringify([value.ownerEpoch, value.mediaRevision, value.partIndex, value.timeInPart, value.positionSec, value.durationSec, value.playbackRate]),
    });
    this.acknowledged = acknowledged;
  }

  getAcknowledged(key: AudioSourceKey): { epoch: string; sequence: number } | undefined { return this.acknowledged.get(audioSourceId(key)); }
}

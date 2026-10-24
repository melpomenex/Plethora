import type { AudioSourceKey } from "../../types/audioEdition";
import { audioSourceId } from "./audioPlaybackPersistence";
import { validateAudioSourceKey } from "./audioCheckpointValidation";

/** Only persisted identities cross the owner boundary; decoder URLs never identify queue items. */
export function validateAudioQueue(queue: readonly AudioSourceKey[], current: AudioSourceKey): AudioSourceKey[] {
  if (queue.length > 128) throw new Error("Audio queue is too large");
  validateAudioSourceKey(current);
  const seen = new Set<string>();
  const copy = queue.map(key => {
    validateAudioSourceKey(key);
    if (key.profileKey !== current.profileKey) throw new Error("Audio queue identity is invalid");
    const id = audioSourceId(key);
    if (seen.has(id)) throw new Error("Audio queue contains duplicate identities");
    seen.add(id);
    return { profileKey: key.profileKey, kind: key.kind, sourceId: key.sourceId };
  });
  if (copy.length && !seen.has(audioSourceId(current))) throw new Error("Audio queue does not contain the current source");
  return copy;
}

export function adjacentAudioSource(queue: readonly AudioSourceKey[], current: AudioSourceKey, direction: -1 | 1): AudioSourceKey | undefined {
  const index = queue.findIndex(key => audioSourceId(key) === audioSourceId(current));
  return index < 0 ? undefined : queue[index + direction];
}

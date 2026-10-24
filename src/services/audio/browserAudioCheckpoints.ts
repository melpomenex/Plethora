import { openDatabase, type Document, type PodcastEpisodeRecord } from "../../lib/database";
import type { AudioCheckpoint, AudioSourceKey, SavedAudioSession, SavedAudioSessionRecord } from "../../types/audioEdition";
import { audioSourceId } from "./audioPlaybackPersistence";
import { validateAudioCheckpoint, validateAudioSourceKey, validateSavedAudioSession } from "./audioCheckpointValidation";

type Row<T> = { key: string; value: T };
export type CheckpointDisposition = "accepted" | "duplicate" | "stale";

/** Shared database transaction keeps browser compatibility progress atomic too. */
async function transaction<T>(write: boolean, body: (tx: IDBTransaction, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(["audio_playback", "documents", "podcast_episodes"], write ? "readwrite" : "readonly");
    let result: T;
    let error: Error | undefined;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(error || tx.error || new Error("Audio transaction aborted"));
    tx.onerror = () => { error ??= tx.error; };
    const fail = (failure: Error) => { error = failure; tx.abort(); };
    try { body(tx, value => { result = value; }, fail); } catch (error) { fail(error as Error); }
  });
}

export function claimBrowserAudioOwner(profile: string, epoch: string, previous?: string): Promise<boolean> {
  validateAudioSourceKey({ profileKey: profile, kind: "audiobook", sourceId: epoch });
  return transaction(true, (tx, done) => {
    const store = tx.objectStore("audio_playback");
    const key = `owner:${profile}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = (request.result as Row<string> | undefined)?.value;
      if (current && current !== epoch && current !== previous) { done(false); return; }
      store.put({ key, value: epoch });
      done(true);
    };
  });
}

export function getBrowserAudioCheckpoint(source: AudioSourceKey): Promise<AudioCheckpoint | null> {
  validateAudioSourceKey(source);
  return transaction(false, (tx, done, fail) => {
    const request = tx.objectStore("audio_playback").get(`checkpoint:${audioSourceId(source)}`);
    request.onsuccess = () => {
      const value = (request.result as Row<AudioCheckpoint> | undefined)?.value ?? null;
      try { if (value) validateAudioCheckpoint(value); done(value); } catch (error) { fail(error as Error); }
    };
  });
}

export function getBrowserAudioSession(profile: string): Promise<SavedAudioSessionRecord | null> {
  return transaction(false, (tx, done) => {
    const store = tx.objectStore("audio_playback");
    const owner = store.get(`owner:${profile}`);
    const session = store.get(`session:${profile}`);
    session.onsuccess = () => {
      const epoch = (owner.result as Row<string> | undefined)?.value;
      const value = (session.result as Row<SavedAudioSession> | undefined)?.value ?? null;
      try {
        if (value) validateSavedAudioSession(value, profile);
        done(epoch ? { ownerEpoch: epoch, session: value } : null);
      } catch { done(epoch ? { ownerEpoch: epoch, session: null, invalidSession: true } : null); }
    };
  });
}

export function saveBrowserAudioSession(profile: string, epoch: string, session: SavedAudioSession): Promise<boolean> {
  validateSavedAudioSession(session, profile);
  return transaction(true, (tx, done) => {
    const store = tx.objectStore("audio_playback");
    const owner = store.get(`owner:${profile}`);
    owner.onsuccess = () => {
      if ((owner.result as Row<string> | undefined)?.value !== epoch) { done(false); return; }
      store.put({ key: `session:${profile}`, value: session });
      done(true);
    };
  });
}

export function commitBrowserAudioCheckpoint(checkpoint: AudioCheckpoint): Promise<CheckpointDisposition> {
  validateAudioCheckpoint(checkpoint);
  return transaction(true, (tx, done, fail) => {
    const store = tx.objectStore("audio_playback");
    const owner = store.get(`owner:${checkpoint.sourceKey.profileKey}`);
    owner.onsuccess = () => {
      if ((owner.result as Row<string> | undefined)?.value !== checkpoint.ownerEpoch) { done("stale"); return; }
      const key = `checkpoint:${audioSourceId(checkpoint.sourceKey)}`;
      const current = store.get(key);
      current.onsuccess = () => {
        const old = (current.result as Row<AudioCheckpoint> | undefined)?.value;
        if (old?.ownerEpoch === checkpoint.ownerEpoch && old.checkpointSequence >= checkpoint.checkpointSequence) { done("duplicate"); return; }
        store.put({ key, value: checkpoint });
        projectProgress(tx, checkpoint, fail);
        done("accepted");
      };
    };
  });
}

function projectProgress(tx: IDBTransaction, checkpoint: AudioCheckpoint, fail: (error: Error) => void): void {
  const source = checkpoint.sourceKey;
  if (checkpoint.positionSec === null) return;
  if (source.kind === "audio_edition" || source.kind === "recording") return;
  const documents = tx.objectStore("documents");
  const update = (document: Document) => {
    const progress = checkpoint.durationSec ? checkpoint.positionSec / checkpoint.durationSec * 100 : document.progress_percent;
    documents.put({ ...document, position_json: JSON.stringify({ type: "time", seconds: checkpoint.positionSec, ...(checkpoint.durationSec === null ? {} : { total_duration: checkpoint.durationSec }) }), progress_percent: progress, date_modified: new Date(checkpoint.updatedAt).toISOString() });
  };
  if (source.kind === "audiobook") {
    const request = documents.get(source.sourceId);
    request.onsuccess = () => {
      const document = request.result as Document | undefined;
      if (!document || document.file_type !== "audio") { fail(new Error("Audiobook unavailable")); return; }
      update(document);
    };
    return;
  }
  const episodes = tx.objectStore("podcast_episodes");
  const episode = episodes.get(source.sourceId);
  episode.onsuccess = () => {
    const value = episode.result as PodcastEpisodeRecord | undefined;
    if (!value) { fail(new Error("Podcast episode unavailable")); return; }
    episodes.put({ ...value, playback_position: checkpoint.positionSec });
    const cursor = documents.openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      const document = cursor.result.value as Document & { metadata?: { source?: string } };
      if (document.file_type === "audio" && document.metadata?.source === `podcast:${source.sourceId}`) update(document);
      cursor.result.continue();
    };
  };
}

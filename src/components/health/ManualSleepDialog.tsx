import { useEffect, useId, useState, type FormEvent } from "react";
import { healthApi } from "../../api/health";
import type { CanonicalSleepEpisode, SleepKind } from "../../types/health";
import { Button } from "../md3/Button";
import { HealthDialog } from "./HealthDialog";
import { healthError } from "./healthFormat";

function localInput(atMs: number) {
  const date = new Date(atMs);
  return new Date(atMs - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localTimestamp(value: string, date: Date): string {
  const offset = -date.getTimezoneOffset();
  const parts = [Math.floor(Math.abs(offset) / 60), Math.abs(offset) % 60]
    .map((value) => String(value).padStart(2, "0"));
  return `${value}:00${offset < 0 ? "-" : "+"}${parts.join(":")}`;
}

export function ManualSleepDialog({ episode, onClose, onSaved }: {
  episode?: CanonicalSleepEpisode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const now = Date.now();
  const [start, setStart] = useState(() => localInput(episode?.startAtMs ?? now - 8 * 3_600_000));
  const [end, setEnd] = useState(() => localInput(episode?.endAtMs ?? now));
  const [kind, setKind] = useState<SleepKind>(episode?.sleepKind ?? "main_sleep");
  const rawSessionId = episode?.primaryRawSessionId;
  const [notes, setNotes] = useState("");
  const [quality, setQuality] = useState("");
  const [detailsLoaded, setDetailsLoaded] = useState(!rawSessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!rawSessionId) return;
    let active = true;
    healthApi.getManualSleep(rawSessionId).then((details) => {
      if (!active) return;
      setNotes(details.notes ?? "");
      setQuality(details.subjectiveQuality?.toString() ?? "");
      setDetailsLoaded(true);
    }).catch((cause) => { if (active) setError(healthError(cause)); });
    return () => { active = false; };
  }, [rawSessionId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startTime = new Date(start);
    const endTime = new Date(end);
    if (!Number.isFinite(startTime.getTime()) || !(endTime.getTime() > startTime.getTime())) {
      setError("Wake time must be after the start time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await healthApi.upsertManualSleep({
        id: episode?.primaryRawSessionId,
        startIso: localTimestamp(start, startTime),
        endIso: localTimestamp(end, endTime),
        sleepKind: kind,
        notes: notes.trim() || null,
        subjectiveQuality: quality ? Number(quality) : null,
      });
      onSaved();
    } catch (cause) {
      setError(healthError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!episode) return;
    setBusy(true);
    try {
      await healthApi.deleteManualSleep(episode.primaryRawSessionId);
      onSaved();
    } catch (cause) {
      setError(healthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <HealthDialog title={episode ? "Edit sleep" : "Log sleep"} onClose={onClose}>
      <form className="health-form" onSubmit={submit}>
        <label htmlFor={`${id}-start`}>Sleep started</label>
        <input id={`${id}-start`} type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        <label htmlFor={`${id}-end`}>Woke up</label>
        <input id={`${id}-end`} type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
        <label htmlFor={`${id}-kind`}>Sleep type</label>
        <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as SleepKind)}>
          <option value="main_sleep">Main sleep</option><option value="nap">Nap</option>
        </select>
        <label htmlFor={`${id}-quality`}>Sleep quality (optional)</label>
        <select id={`${id}-quality`} value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="">Choose a rating</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
        <label htmlFor={`${id}-notes`}>Notes (optional)</label>
        <textarea id={`${id}-notes`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p role="alert" className="health-error">{error}</p>}
        {confirmDelete && <p role="status">Delete this sleep entry from the vault?</p>}
        <div className="health-actions">
          <Button variant="text" onClick={onClose}>Cancel</Button>
          {episode && (confirmDelete
            ? <Button variant="destructive" onClick={remove} disabled={busy}>Confirm deletion</Button>
            : <Button variant="text" onClick={() => setConfirmDelete(true)}>Delete entry</Button>)}
          <Button variant="filled" type="submit" disabled={busy || !detailsLoaded}>Save sleep</Button>
        </div>
      </form>
    </HealthDialog>
  );
}

import type { AudioSourceKey } from "../../types/audioEdition";
import type { MarkerType } from "../../types/audioEdition";
import { addListeningSessionItem } from "../../api/listeningSessions";

/** A capture-type Study Mode press journaled while JavaScript was unavailable. */
export interface DeferredStudyCapture {
  eventId: string;
  command: string;
  studyAction: string;
  sourceKey: AudioSourceKey;
  sessionId?: string | null;
  generation?: number | null;
  section?: { id?: string; index?: number; title?: string } | null;
  partIndex?: number | null;
  positionHintSec?: number | null;
  positionSec?: number | null;
  occurredAt?: number | null;
}

const CAPTURE_ACTIONS = new Set([
  "save_recent_extract",
  "bookmark",
  "mark_interesting",
  "mark_confusing",
  "ask_plethora",
]);

const LABELS: Record<string, string> = {
  save_recent_extract: "Extract mark",
  bookmark: "Bookmark",
  mark_interesting: "Interesting",
  mark_confusing: "Needs explanation",
  ask_plethora: "Question",
};

const MARKER_TYPES: Record<string, MarkerType> = {
  bookmark: "bookmark",
  mark_interesting: "interesting",
  mark_confusing: "confusing",
};

export function isDeferredStudyAction(action: string): boolean {
  return CAPTURE_ACTIONS.has(action);
}

export function deferredCaptureTime(capture: DeferredStudyCapture): number {
  const value = Number.isFinite(capture.positionHintSec)
    ? capture.positionHintSec
    : capture.positionSec;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function deferredCaptureAnchor(capture: DeferredStudyCapture): string {
  const part = Number.isInteger(capture.partIndex) ? capture.partIndex : 0;
  return `audio:${capture.sourceKey.kind}:${capture.sourceKey.sourceId}#part-${part}@${deferredCaptureTime(capture).toFixed(3)}`;
}

function clock(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

/**
 * Persist a deferred capture with the original press-time provenance. There is
 * no anchor text at capture time, so this is a pending bookmark — never
 * fabricated transcript text. Throws while storage is unavailable so the
 * native journal keeps the record dirty for a later retry.
 */
export async function executeDeferredStudyCapture(capture: DeferredStudyCapture): Promise<void> {
  if (!isDeferredStudyAction(capture.studyAction)) return;
  if (!capture.sessionId) throw new Error("Deferred study capture has no listening session");
  const position = deferredCaptureTime(capture);
  const section =
    capture.section?.title ||
    (capture.section?.id ? String(capture.section.id) : `Part ${(capture.partIndex ?? 0) + 1}`);
  await addListeningSessionItem({
    sessionId: capture.sessionId,
    extractId: null,
    markerType: MARKER_TYPES[capture.studyAction] ?? "bookmark",
    audioTimestamp: position,
    sourceAnchor: deferredCaptureAnchor(capture),
    snippetText: "",
    note: `${LABELS[capture.studyAction] ?? "Capture"} from ${section} at ${clock(position)}`,
  });
}

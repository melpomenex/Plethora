import type { TranscriptionQueueEntry } from "../../api/transcription";
import { estimateCost } from "../../services/transcription/pricing";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TranscriptionJobProgressLabel({
  entry,
}: {
  entry: Pick<
    TranscriptionQueueEntry,
    "progress" | "processedDurationMs" | "totalDurationMs" | "provider" | "transcriptionMode"
  >;
}) {
  const processedMs = entry.processedDurationMs ?? 0;
  const totalMs = entry.totalDurationMs ?? undefined;
  const durationLabel =
    totalMs && totalMs > 0
      ? `${formatDuration(processedMs)} / ${formatDuration(totalMs)}`
      : `${entry.progress}% complete`;

  const cost =
    totalMs && totalMs > 0
      ? estimateCost(totalMs / 1000, entry.provider)
      : undefined;

  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{durationLabel}</p>
      {typeof cost === "number" && cost > 0 ? (
        <p className="text-[10px] text-muted-foreground/80">
          Est. cost ${cost.toFixed(3)}
          {entry.transcriptionMode ? ` · ${entry.transcriptionMode}` : ""}
        </p>
      ) : null}
    </div>
  );
}

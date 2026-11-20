export function durationLabel(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return hours ? `${hours}h ${rounded % 60}m` : `${rounded}m`;
}

export function clockLabel(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const rounded = Math.round(minutes) % 1440;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(date));
}

export function sourceTimestamp(atMs: number, offsetSecs: number | null): string {
  const local = new Date(atMs + (offsetSecs ?? 0) * 1_000).toISOString().slice(0, 19).replace("T", " ");
  if (offsetSecs === null) return `${local} UTC`;
  const offsetMins = Math.floor(Math.abs(offsetSecs) / 60);
  return `${local} (UTC${offsetSecs < 0 ? "−" : "+"}${clockLabel(offsetMins)})`;
}

export function localDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function defaultHealthRange(days = 90) {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return { startMs: start.getTime(), endMs: end.getTime(), tzOffsetSecs: -end.getTimezoneOffset() * 60 };
}

export function healthError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The health operation could not be completed.";
}

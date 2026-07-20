export function formatArenaInterval(days: number, locale?: string): string {
  if (!Number.isFinite(days) || days <= 0) return "—";
  const formatUnit = (
    value: number,
    unit: Intl.NumberFormatOptions["unit"],
    maximumFractionDigits = 0,
  ) => new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits,
  }).format(value);

  const minutes = days * 1_440;
  if (minutes < 60) return formatUnit(Math.max(1, Math.round(minutes)), "minute");
  const hours = days * 24;
  if (hours < 24) return formatUnit(Math.round(hours), "hour");
  if (days < 14) return formatUnit(Math.round(days), "day");
  if (days < 60) return formatUnit(Math.round(days / 7), "week");
  if (days < 730) {
    const months = days / 30.4375;
    return formatUnit(months < 10 ? Number(months.toFixed(1)) : Math.round(months), "month", months < 10 ? 1 : 0);
  }
  const years = days / 365.25;
  return formatUnit(years < 10 ? Number(years.toFixed(1)) : Math.round(years), "year", years < 10 ? 1 : 0);
}

export function formatArenaDueDate(dueAt: string, locale?: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function arenaDueAtFromDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

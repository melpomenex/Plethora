export interface HorizonPoint {
  id: string;
  intervalDays: number;
}

export interface HorizonCluster {
  position: number;
  points: HorizonPoint[];
}

export function horizonPosition(intervalDays: number, maxDays: number): number {
  if (!Number.isFinite(intervalDays) || !Number.isFinite(maxDays) || maxDays <= 0) return 0;
  return Math.max(0, Math.min(100, (Math.log1p(Math.max(0, intervalDays)) / Math.log1p(maxDays)) * 100));
}

export function horizonDaysAt(position: number, maxDays: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(maxDays) || maxDays <= 0) return 0;
  const ratio = Math.max(0, Math.min(100, position)) / 100;
  return Math.expm1(ratio * Math.log1p(maxDays));
}

export function clampCustomInterval(days: number, minDays: number, maxDays: number): number {
  if (!Number.isFinite(days)) return minDays;
  return Math.max(minDays, Math.min(maxDays, days));
}

const NATURAL_TICKS = [
  1 / 1_440,
  5 / 1_440,
  15 / 1_440,
  1 / 24,
  6 / 24,
  1,
  3,
  7,
  14,
  30.4375,
  91.3125,
  182.625,
  365.25,
  365.25 * 2,
  365.25 * 5,
  365.25 * 10,
  365.25 * 25,
  365.25 * 50,
  44_530,
] as const;

export function horizonTicks(maxDays: number, targetCount = 6): number[] {
  if (!Number.isFinite(maxDays) || maxDays <= 0) return [];
  const available = NATURAL_TICKS.filter((tick) => tick < maxDays);
  if (available.length <= targetCount - 1) return [...available, maxDays];
  const picked = new Set<number>();
  for (let index = 1; index < targetCount; index += 1) {
    const targetPosition = (index / targetCount) * 100;
    let best = available[0];
    let bestDistance = Infinity;
    for (const tick of available) {
      const distance = Math.abs(horizonPosition(tick, maxDays) - targetPosition);
      if (distance < bestDistance) {
        best = tick;
        bestDistance = distance;
      }
    }
    picked.add(best);
  }
  return [...picked].sort((left, right) => left - right).concat(maxDays);
}

export function groupHorizonCollisions(
  points: HorizonPoint[],
  maxDays: number,
  thresholdPercent = 3,
): HorizonCluster[] {
  const sorted = [...points].sort((left, right) =>
    left.intervalDays - right.intervalDays || left.id.localeCompare(right.id));
  const clusters: HorizonCluster[] = [];
  for (const point of sorted) {
    const position = horizonPosition(point.intervalDays, maxDays);
    const current = clusters.at(-1);
    if (current && Math.abs(position - current.position) <= thresholdPercent) {
      current.points.push(point);
      current.position = current.points.reduce(
        (sum, entry) => sum + horizonPosition(entry.intervalDays, maxDays),
        0,
      ) / current.points.length;
    } else {
      clusters.push({ position, points: [point] });
    }
  }
  return clusters;
}

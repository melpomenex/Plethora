export type PdfHistoryDirection = "back" | "forward";

interface HistoryLocationBase {
  pageNumber: number;
  zoomMode: "custom" | "fit-width" | "fit-page";
  scale: number;
}

export type PdfHistoryLocation = HistoryLocationBase & (
  | { mode: "fixed"; point?: [number, number] }
  | { mode: "reflow"; pageOffset: number }
);

const LIMIT = 64;

function validLocation(value: unknown): value is PdfHistoryLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as PdfHistoryLocation;
  if (!Number.isSafeInteger(location.pageNumber) || location.pageNumber < 1 ||
      !Number.isFinite(location.scale) || location.scale <= 0 ||
      !["custom", "fit-width", "fit-page"].includes(location.zoomMode)) return false;
  if (location.mode === "reflow") {
    return Number.isFinite(location.pageOffset) && location.pageOffset >= 0 && location.pageOffset <= 1;
  }
  return location.mode === "fixed" && (location.point === undefined ||
    Array.isArray(location.point) && location.point.length === 2 && location.point.every(Number.isFinite));
}

function sameLocation(a: PdfHistoryLocation, b: PdfHistoryLocation): boolean {
  if (a.pageNumber !== b.pageNumber || a.mode !== b.mode || a.scale !== b.scale || a.zoomMode !== b.zoomMode) return false;
  if (a.mode === "reflow" && b.mode === "reflow") return Math.abs(a.pageOffset - b.pageOffset) < 0.001;
  if (a.mode === "fixed" && b.mode === "fixed") {
    if (!a.point || !b.point) return true;
    return Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]) < 1;
  }
  return false;
}

/** Entries move only once the reader verifies that the owned jump landed. */
export class PdfNavigationHistory {
  private back: PdfHistoryLocation[] = [];
  private forward: PdfHistoryLocation[] = [];
  private pending: { token: number; origin: PdfHistoryLocation; direction?: PdfHistoryDirection } | undefined;

  constructor(private readonly key?: string) {
    if (!key) return;
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!Array.isArray(stored?.back) || !Array.isArray(stored?.forward)) return;
      this.back = stored.back.slice(-LIMIT).filter(validLocation);
      this.forward = stored.forward.slice(-LIMIT).filter(validLocation);
    } catch {
      // A reader in a restricted webview can still navigate within this session.
    }
  }

  peek(direction: PdfHistoryDirection): PdfHistoryLocation | undefined {
    return this[direction].at(-1);
  }

  begin(token: number, origin: PdfHistoryLocation, direction?: PdfHistoryDirection): void {
    if (validLocation(origin)) this.pending = { token, origin, direction };
  }

  cancel(): void {
    this.pending = undefined;
  }

  settle(token: number, destination: PdfHistoryLocation): boolean {
    const pending = this.pending;
    if (!pending || pending.token !== token) return false;
    this.cancel();
    if (pending.direction) {
      this[pending.direction].pop();
      this.push(pending.direction === "back" ? "forward" : "back", pending.origin);
    } else {
      if (sameLocation(pending.origin, destination)) return false;
      this.push("back", pending.origin);
      this.forward = [];
    }
    this.persist();
    return true;
  }

  private push(direction: PdfHistoryDirection, location: PdfHistoryLocation): void {
    const stack = this[direction];
    stack.push(location);
    if (stack.length > LIMIT) stack.shift();
  }

  private persist(): void {
    if (!this.key) return;
    try {
      localStorage.setItem(this.key, JSON.stringify({ back: this.back, forward: this.forward }));
    } catch {
      // Session navigation remains available.
    }
  }
}

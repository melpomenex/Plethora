/** One coalesced write path. No React updates or source work on motion frames. */
export class AssistantSheetMotion {
  private frame: number | null = null;
  private epoch = 0;
  private current = 0;
  private pending = 0;
  constructor(private paint: (reveal: number) => void, private raf: typeof requestAnimationFrame = callback => window.requestAnimationFrame(callback), private caf: typeof cancelAnimationFrame = id => window.cancelAnimationFrame(id)) {}
  sample() { return this.current; }
  interrupt() {
    this.epoch++;
    if (this.frame !== null) this.caf(this.frame);
    this.frame = null;
    return this.current;
  }
  drag(reveal: number) {
    this.pending = reveal;
    if (this.frame !== null) return;
    this.frame = this.raf(() => { this.frame = null; this.current = this.pending; this.paint(this.current); });
  }
  settle(target: number, immediate: boolean, complete: () => void) {
    const from = this.interrupt();
    const epoch = this.epoch;
    this.paint(from);
    if (immediate) { this.current = target; this.paint(target); complete(); return; }
    let began: number | undefined;
    const tick = (now: number) => {
      if (epoch !== this.epoch) return;
      began ??= now;
      const seconds = Math.min(0.32, (now - began) / 1000);
      const omega = Math.sqrt(320);
      const displacement = (from - target) * (1 + omega * seconds) * Math.exp(-omega * seconds);
      const speed = Math.abs((from - target) * omega * omega * seconds * Math.exp(-omega * seconds));
      this.current = target + displacement;
      this.paint(this.current);
      if (seconds >= 0.32 || (Math.abs(displacement) < 0.5 && speed < 5)) {
        this.frame = null; this.current = target; this.paint(target);
        if (epoch === this.epoch) complete();
      } else this.frame = this.raf(tick);
    };
    this.frame = this.raf(tick);
  }
}

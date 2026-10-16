import { describe, expect, it, vi } from "vitest";
import { AssistantSheetMotion } from "../motion";
function fixture() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const paint = vi.fn();
  const motion = new AssistantSheetMotion(paint, cb => { callbacks.set(++id, cb); return id; }, n => { callbacks.delete(n); });
  const tick = (now: number) => { const frames = [...callbacks.values()]; callbacks.clear(); frames.forEach(cb => cb(now)); };
  return { motion, callbacks, paint, tick };
}
describe("Assistant coalesced motion", () => {
  it("paints the latest displacement once per frame", () => {
    const f = fixture(); for (let i = 0; i < 100; i++) f.motion.drag(i);
    expect(f.callbacks.size).toBe(1); f.tick(0); expect(f.paint).toHaveBeenCalledExactlyOnceWith(99);
  });
  it("bounds settlement and completes exactly once", () => {
    const f = fixture(); const complete = vi.fn(); f.motion.settle(360, false, complete);
    for (let t = 0; t <= 400; t += 16) f.tick(t);
    expect(f.motion.sample()).toBe(360); expect(complete).toHaveBeenCalledOnce(); expect(f.callbacks.size).toBe(0);
  });
  it("interruption resumes from sampled position and stale completion cannot reopen", () => {
    const f = fixture(); const stale = vi.fn(); f.motion.settle(360, false, stale); f.tick(0); f.tick(64); const sample = f.motion.sample(); const pending = [...f.callbacks.values()];
    expect(sample).toBeGreaterThan(0); expect(sample).toBeLessThan(360);
    f.motion.settle(0, false, () => {}); pending.forEach(cb => cb(400)); expect(stale).not.toHaveBeenCalled(); f.tick(100); expect(f.motion.sample()).toBeCloseTo(sample);
  });
  it("reduced motion settles immediately with no queued animation", () => {
    const f = fixture(); const complete = vi.fn(); f.motion.settle(360, true, complete); expect(f.motion.sample()).toBe(360); expect(complete).toHaveBeenCalledOnce(); expect(f.callbacks.size).toBe(0);
  });
});

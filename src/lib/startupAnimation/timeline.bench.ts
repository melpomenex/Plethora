/**
 * Knowledge Peck timeline micro-benchmark (task 11.1, change
 * knowledge-peck-startup-animation).
 *
 * Benches the pure hot paths the startup overlay exercises once per launch:
 * `buildTimeline` (registry lookup + phase closure) and a full canonical
 * desktop `sampleTimeline` sweep across the whole virtual timeline at frame
 * granularity. Deterministic inputs only — no PRNG, clock, network, or Tauri
 * runtime; results fold into a module-level sink so the engine cannot elide
 * the loops (bench bodies return void per repo protocol).
 */
import { bench } from "vitest";
import { buildTimeline, sampleTimeline } from "./timeline";

let sink = 0;

const desktop = buildTimeline("knowledge-peck", "desktop");
const phone = buildTimeline("knowledge-peck", "phone");

// Frame-granular sweep times (virtual ms), shared by both sweep benches.
const frameTimes: number[] = [];
for (let t = 0; t <= desktop.script.revealEnd; t += 1000 / 60) {
  frameTimes.push(t);
}

bench("kp-timeline/build", () => {
  let fold = 0;
  for (let i = 0; i < 200; i++) {
    const tl = buildTimeline("knowledge-peck", i % 2 === 0 ? "desktop" : "phone");
    fold += tl.phases.length;
  }
  sink += fold;
});

bench("kp-timeline/sample-sweep-desktop", () => {
  let fold = 0;
  for (const t of frameTimes) {
    const states = sampleTimeline(desktop, t);
    fold += states.length;
    for (const state of states) {
      fold += state.opacity;
    }
  }
  sink += fold;
});

bench("kp-timeline/sample-sweep-phone", () => {
  let fold = 0;
  const frames: number[] = [];
  for (let t = 0; t <= phone.script.revealEnd; t += 1000 / 60) {
    frames.push(t);
  }
  for (const t of frames) {
    const states = sampleTimeline(phone, t);
    fold += states.length;
    for (const state of states) {
      fold += state.opacity;
    }
  }
  sink += fold;
});

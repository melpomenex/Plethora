/**

 Global switch consulted by every Yjs write path (task 6.6, P5 cutover:
 "stop publishing to Yjs; keep reading it"). A single module-level flag
 rather than a per-entity setting because P5 is an all-or-nothing room-level
 transition — design.md never suggests suppressing writes for some domains
 but not others.

 Deliberately does NOT gate the READ path (map.observe/replay) — P5/P6
 explicitly keep reading Yjs so a not-yet-upgraded peer's writes still land,
 right up until P6 confirms nothing has arrived via Yjs-only for the
 quiesce window.

*/

let suppressed = false;

export function isYjsPublishSuppressed(): boolean {
  return suppressed;
}

export function setYjsPublishSuppressed(value: boolean): void {
  suppressed = value;
}

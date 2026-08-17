/**
 * Shared DOM-stability detection for the rendered-page fallback (design D5).
 *
 * The script below is injected into capture WebViews (desktop hidden window;
 * conceptually the same algorithm runs as the Kotlin poller on Android and
 * the iframe poller in PWA — see captureClient.ts). It waits for
 * `readyState === 'complete'`, samples (nodeCount, textLength, imageCount)
 * every SAMPLE_INTERVAL, and declares stability after the sample tuple is
 * unchanged for the STABILITY_WINDOW, bounded by STABILIZE_CAP after load and
 * the overall budget. No arbitrary sleeps. When stable, it POSTs
 * `finalUrl + '\n' + outerHTML` to the one-shot loopback endpoint the native
 * side provisioned (`__incCaptureEndpoint`, which embeds the one-shot token
 * in its path — so the request is a CORS-simple POST with no custom headers).
 *
 * Keep the constants in sync with extractor-config.ts (the values below are
 * inlined because the script runs as a plain string inside the capture
 * WebView, where this module is not loadable).
 */

import {
  RENDERED_CAPTURE_BUDGET_MS,
  STABILITY_SAMPLE_INTERVAL_MS,
  STABILIZE_CAP_MS,
  STABILITY_WINDOW_MS,
} from '../extractor-config';

export const STABILITY_SCRIPT_CONSTANTS = {
  sampleIntervalMs: STABILITY_SAMPLE_INTERVAL_MS,
  stabilityWindowMs: STABILITY_WINDOW_MS,
  stabilizeCapMs: STABILIZE_CAP_MS,
  overallBudgetMs: RENDERED_CAPTURE_BUDGET_MS,
} as const;

/** The script source injected via `initialization_script` on desktop and
 * `evaluateJavascript` on Android. Runs on every top-level navigation. */
export const DOM_STABILITY_SCRIPT = String.raw`
(function () {
  if (window.__incCaptureStarted) return;
  window.__incCaptureStarted = true;
  var SAMPLE = ${STABILITY_SAMPLE_INTERVAL_MS}, WINDOW = ${STABILITY_WINDOW_MS}, CAP = ${STABILIZE_CAP_MS}, BUDGET = ${RENDERED_CAPTURE_BUDGET_MS};
  var started = Date.now(), loadedAt = 0;
  var lastSample = null, stableSince = 0, done = false, loaded = false;
  function sample() {
    try {
      var nodes = document.getElementsByTagName('*').length;
      var text = document.body ? (document.body.innerText || '').length : 0;
      var images = document.images ? document.images.length : 0;
      return nodes + '|' + text + '|' + images;
    } catch (e) { return 'err'; }
  }
  function post() {
    if (done) return;
    done = true;
    try {
      var payload = location.href + '\n' + '<!doctype html>' + document.documentElement.outerHTML;
      fetch(window.__incCaptureEndpoint, { method: 'POST', body: payload })
        .catch(function () {});
    } catch (e) { /* the receiver times out; the capture fails typed */ }
  }
  function tick() {
    var now = Date.now();
    if (now - started > BUDGET) { post(); return; }
    if (document.readyState === 'complete' && !loaded) { loaded = true; loadedAt = now; }
    if (!loaded) return;
    var s = sample();
    if (s === lastSample) {
      if (now - stableSince >= WINDOW) { post(); return; }
      if (now - loadedAt > CAP) { post(); return; }
    } else {
      lastSample = s;
      stableSince = now;
    }
  }
  setInterval(tick, SAMPLE);
})();
`;

/**
 * Same stability algorithm, expressed as a TS poller for the PWA iframe
 * client (and injectable fakes): returns true when the sampled tuple has
 * been unchanged for the window (or the cap is hit after load).
 */
export async function waitForDomStability(
  sample: () => string,
  isLoaded: () => boolean,
  shouldStop: () => boolean,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<boolean> {
  const started = Date.now();
  let loadedAt = 0;
  let lastSample: string | null = null;
  let stableSince = 0;

  while (!shouldStop()) {
    const now = Date.now();
    if (now - started > RENDERED_CAPTURE_BUDGET_MS) return false;
    if (isLoaded() && loadedAt === 0) loadedAt = now;
    if (loadedAt > 0) {
      const s = sample();
      if (s === lastSample) {
        if (now - stableSince >= STABILITY_WINDOW_MS) return true;
        if (now - loadedAt > STABILIZE_CAP_MS) return true;
      } else {
        lastSample = s;
        stableSince = now;
      }
    }
    await sleep(STABILITY_SAMPLE_INTERVAL_MS);
  }
  return false;
}

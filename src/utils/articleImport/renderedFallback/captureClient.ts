/**
 * Rendered-DOM capture clients and the platform registry (design D5).
 *
 * | Platform | Mechanism                                          |
 * |----------|----------------------------------------------------|
 * | Android  | offscreen bare WebView via the folder-import plugin (IPC-less) |
 * | Desktop  | hidden `article-capture-*` WebviewWindow via the `capture_rendered_dom` command (capability-free) |
 * | PWA      | best-effort hidden iframe (X-Frame-Options limited) |
 *
 * All clients implement `RenderedDomCapture`; tests inject fakes. Native
 * clients return typed failure strings the registry maps to
 * `rendered_unavailable` / `rendered_failed`.
 */

import { isTauri } from '../../../lib/tauri';
import { nativePlatform } from '../../../lib/tauri';
import type { RenderedCaptureResult } from '../types';
import { waitForDomStability } from './stabilityScript';
import { RENDERED_CAPTURE_BUDGET_MS } from '../extractor-config';

export interface RenderedDomCapture {
  /** Capture the rendered DOM of `url`, resolving or throwing
   * `RenderedCaptureError`. */
  capture(url: string, timeoutMs?: number, signal?: AbortSignal): Promise<RenderedCaptureResult>;
}

export type RenderedCaptureFailReason = 'unavailable' | 'failed' | 'timeout' | 'canceled';

export class RenderedCaptureError extends Error {
  readonly reason: RenderedCaptureFailReason;
  constructor(reason: RenderedCaptureFailReason, detail?: string) {
    super(detail ?? reason);
    this.name = 'RenderedCaptureError';
    this.reason = reason;
  }
}

interface NativeCaptureResponse {
  html: string;
  finalUrl: string;
  durationMs: number;
}

async function invokeTauri<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Android: the folder-import plugin's offscreen WebView. */
export const androidCapture: RenderedDomCapture = {
  async capture(url, timeoutMs = RENDERED_CAPTURE_BUDGET_MS, signal) {
    if (signal?.aborted) throw new RenderedCaptureError('canceled');
    try {
      const res = await invokeTauri<NativeCaptureResponse | { error: string }>(
        'plugin:folder-import|capture_rendered_dom',
        { url, timeoutMs }
      );
      if ('error' in res) {
        throw mapNativeError(res.error);
      }
      return { html: res.html, finalUrl: res.finalUrl, durationMs: res.durationMs };
    } catch (err) {
      if (err instanceof RenderedCaptureError) throw err;
      throw mapNativeError(err instanceof Error ? err.message : String(err));
    }
  },
};

/** Desktop: the app's hidden-window capture command. */
export const desktopCapture: RenderedDomCapture = {
  async capture(url, timeoutMs = RENDERED_CAPTURE_BUDGET_MS, signal) {
    if (signal?.aborted) throw new RenderedCaptureError('canceled');
    try {
      const res = await invokeTauri<NativeCaptureResponse>('capture_rendered_dom', {
        url,
        timeoutMs,
      });
      return { html: res.html, finalUrl: res.finalUrl, durationMs: res.durationMs };
    } catch (err) {
      if (err instanceof RenderedCaptureError) throw err;
      throw mapNativeError(err instanceof Error ? err.message : String(err));
    }
  },
};

function mapNativeError(message: string): RenderedCaptureError {
  const msg = (message ?? '').toLowerCase();
  if (msg.includes('unavailable')) return new RenderedCaptureError('unavailable', message);
  if (msg.includes('timeout')) return new RenderedCaptureError('timeout', message);
  if (msg.includes('cancel')) return new RenderedCaptureError('canceled', message);
  return new RenderedCaptureError('failed', message);
}

/** PWA: best-effort hidden iframe. Sites sending X-Frame-Options /
 * frame-ancestors never fire load with an accessible document → typed
 * `unavailable`. */
export const iframeCapture: RenderedDomCapture = {
  async capture(url, _timeoutMs = RENDERED_CAPTURE_BUDGET_MS, signal) {
    const started = performance.now();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1024px;height:768px;visibility:hidden;';
    let loaded = false;
    let loadError: unknown = null;

    const cleanup = (): void => {
      iframe.remove();
    };
    const onLoad = (): void => {
      loaded = true;
    };
    const onError = (e: ErrorEvent): void => {
      loadError = e;
    };

    iframe.addEventListener('load', onLoad);
    iframe.addEventListener('error', onError);
    document.body.appendChild(iframe);
    iframe.src = url;

    try {
      const stable = await waitForDomStability(
        () => {
          try {
            const doc = iframe.contentDocument;
            if (!doc) return 'cross-origin';
            const body = doc.body;
            return [
              doc.getElementsByTagName('*').length,
              body ? (body.textContent ?? '').length : 0,
              doc.images.length,
            ].join('|');
          } catch {
            return 'cross-origin';
          }
        },
        () => loaded,
        () => signal?.aborted === true
      );

      if (signal?.aborted) throw new RenderedCaptureError('canceled');

      const doc = (() => {
        try {
          return iframe.contentDocument;
        } catch {
          return null;
        }
      })();
      if (!doc || !doc.documentElement) {
        // Blocked by X-Frame-Options/CSP or a cross-origin document.
        throw new RenderedCaptureError('unavailable', 'iframe document not accessible');
      }
      if (!stable) {
        throw new RenderedCaptureError('timeout', 'iframe did not stabilize in budget');
      }
      if (loadError) {
        throw new RenderedCaptureError('unavailable', 'iframe load error');
      }
      const html = `<!doctype html>${doc.documentElement.outerHTML}`;
      return {
        html,
        finalUrl: doc.location?.href ?? url,
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      cleanup();
    }
  },
};

/**
 * Test seam: the registry used by the pipeline. Tests replace `current`
 * (see `setRenderedCaptureForTests`) to inject deterministic fakes.
 */
export interface RenderedCaptureRegistry {
  current: RenderedDomCapture | null;
  /** Report what the current environment supports. */
  caps(): { native: boolean; iframe: boolean };
}

export const renderedCaptureRegistry: RenderedCaptureRegistry = {
  current: null,
  caps() {
    if (!isTauri()) {
      return { native: false, iframe: typeof document !== 'undefined' };
    }
    const platform = nativePlatform();
    if (platform === 'android') return { native: true, iframe: false };
    if (platform === 'ios') return { native: false, iframe: false };
    return { native: true, iframe: false };
  },
};

/** Resolve the capture client for the current platform (or null when the
 * platform has no capture capability at all). */
export function getRenderedCapture(): RenderedDomCapture | null {
  if (renderedCaptureRegistry.current) return renderedCaptureRegistry.current;
  if (!isTauri()) {
    return typeof document !== 'undefined' ? iframeCapture : null;
  }
  const platform = nativePlatform();
  if (platform === 'android') return androidCapture;
  if (platform === 'ios') return null;
  return desktopCapture;
}

/** Test-only: install a fake capture client (pass null to restore). */
export function setRenderedCaptureForTests(capture: RenderedDomCapture | null): void {
  renderedCaptureRegistry.current = capture;
}

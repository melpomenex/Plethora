/**
 * Frontend helper for the loopback web proxy (`web_proxy.rs`).
 *
 * Resolves an upstream URL to its proxied loopback URL via the
 * `get_web_proxy_url` command, registers the injected bridge script with the
 * proxy, and exposes the proxy origin so the Web Browser tab can validate
 * inbound `postMessage` events (task 3.3).
 */

import { invokeCommand } from "./tauri";
import { WEBVIEW_EXTRACT_BRIDGE_SCRIPT, WEB_BRIDGE_NS } from "./webview-extract-bridge";

let bridgeRegistered = false;
let bridgeRegistration: Promise<void> | null = null;

/**
 * Register the bridge script with the Rust web proxy. Called before the first
 * navigation; idempotent.
 */
export function ensureWebBridgeScriptRegistered(): Promise<void> {
  if (bridgeRegistered) return Promise.resolve();
  if (!bridgeRegistration) {
    bridgeRegistration = invokeCommand("set_web_bridge_script", {
      script: WEBVIEW_EXTRACT_BRIDGE_SCRIPT,
    })
      .then(() => {
        bridgeRegistered = true;
      })
      .catch((error) => {
        bridgeRegistration = null;
        throw error;
      });
  }
  return bridgeRegistration;
}

/**
 * Resolve an upstream URL to its proxied loopback URL, starting the web proxy
 * on first call. Rejects for invalid / private / non-http(s) targets.
 */
export async function resolveWebProxyUrl(upstreamUrl: string): Promise<string> {
  await ensureWebBridgeScriptRegistered();
  return invokeCommand<string>("get_web_proxy_url", { url: upstreamUrl });
}

/**
 * The origin the proxied iframe runs under (`http://127.0.0.1:<port>`).
 * Message events from the iframe must carry exactly this origin.
 */
export function proxyOriginOf(proxyUrl: string): string {
  try {
    return new URL(proxyUrl).origin;
  } catch {
    return "";
  }
}

/**
 * Validate an inbound bridge `MessageEvent` (task 3.3): the source must be the
 * proxied iframe's `contentWindow` and the origin must be the proxy origin.
 * Anything else (a foreign window, a different origin, an unknown frame) is
 * ignored before any payload shape check.
 */
export function isTrustedBridgeEvent(
  event: Pick<MessageEvent, "source" | "origin">,
  frameWindow: Window | null,
  proxyOrigin: string | null
): boolean {
  if (!frameWindow || !proxyOrigin) return false;
  if (event.source !== frameWindow) return false;
  return event.origin === proxyOrigin;
}

/**
 * Ask the proxied frame for its readable text (`document.body.innerText`) via
 * a `text-request` / `text-response` message pair (task 4.3 / design D6).
 *
 * Returns the text, or `""` on timeout, on a frame that is not ready, or when
 * the frame does not answer within `timeoutMs`. The message listener in
 * `WebBrowserTab` ignores `text-response` messages itself — the one-time
 * listener created here resolves the matching request.
 */
export function requestFrameText(
  frame: Window | null,
  proxyOrigin: string | null,
  timeoutMs = 2500
): Promise<string> {
  return new Promise((resolve) => {
    if (!frame || !proxyOrigin) {
      resolve("");
      return;
    }
    const id = Date.now() + Math.floor(Math.random() * 1_000_000);

    const timer = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve("");
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      if (event.source !== frame || event.origin !== proxyOrigin) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const msg = event.data as { ns?: unknown; type?: unknown; payload?: unknown };
      if (msg.ns !== WEB_BRIDGE_NS || msg.type !== "text-response") return;
      const payload = msg.payload as { id?: unknown; text?: unknown } | null;
      if (!payload || payload.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(typeof payload.text === "string" ? payload.text : "");
    };

    window.addEventListener("message", listener);
    frame.postMessage(
      { ns: WEB_BRIDGE_NS, type: "text-request", payload: { id } },
      proxyOrigin
    );
  });
}

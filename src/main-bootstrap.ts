// Keep this module intentionally tiny. It is the only entrypoint loaded by
// index.html so WebKit compatibility patches run before main.tsx's large
// static dependency graph is evaluated.
import { installPromiseCompat } from "./utils/promiseCompat";
import { installUint8ArrayCompat } from "./utils/uint8ArrayCompat";
import React from "react";
import ReactDOM, { type Root } from "react-dom/client";

type BootstrapWindow = Window & {
  __plethoraReactRoot?: Root;
};

installPromiseCompat(globalThis);
installUint8ArrayCompat(globalThis);

// Create the root before importing main.tsx. The latter intentionally has a
// large static dependency graph; waiting for that graph to evaluate defeats
// the point of the static boot frame on a slower WKWebView. Keeping the root
// here gives us an immediate React commit and lets main.tsx only replace the
// placeholder once its optional integrations have evaluated.
const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Plethora bootstrap: #root is missing");
}

const reactRoot = ReactDOM.createRoot(rootEl);
(window as BootstrapWindow).__plethoraReactRoot = reactRoot;
reactRoot.render(
  React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#0a0a0a",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    },
    "Loading Plethora…",
  ),
);
rootEl.setAttribute("data-plethora-mounted", "true");

if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  try {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => crypto.getRandomValues(new Uint8Array(16)).reduce((s, byte, index) => {
        const value = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
        return s + value.toString(16).padStart(2, "0");
      }, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
    });
  } catch {
    // Some WebKit versions expose a non-configurable Crypto object.
  }
}

// Load the large application graph only after the tiny bootstrap has committed
// its root. Tauri's production custom protocol can otherwise hold the initial
// module on its dependency-preload promise before React has painted anything.
//
// main.tsx statically imports every module the old staged waterfall used to
// warm up, so a single dynamic import is equivalent — with one request
// waterfall instead of fifteen, each of which could wedge on the flaky iOS
// dev-server path.
const display = document.getElementById("error-display");

const showStatus = (text: string) => {
  if (!display) return;
  display.textContent = text;
  display.style.display = "block";
};

const hideStatus = () => {
  if (!display) return;
  display.textContent = "";
  display.style.display = "none";
};

const BOOT_START = performance.now();
let settled = false;

// Progress heartbeat. Doubles as a liveness probe: if the elapsed counter
// advances in screenshots, timers and painting work and only the import is
// outstanding.
let bootstrapHeartbeat = 0;
const heartbeat = window.setInterval(() => {
  if (settled) return;
  const elapsed = Math.round((performance.now() - BOOT_START) / 1000);
  showStatus(`Starting Plethora… (${elapsed}s)`);
  bootstrapHeartbeat++;
  document.body?.setAttribute("data-plethora-heartbeat", String(bootstrapHeartbeat));
}, 1000);

// Last-resort recovery: a wedged load can always be retried manually.
window.setTimeout(() => {
  if (settled || !display) return;
  display.addEventListener("click", () => window.location.reload());
  const hint = document.createElement("div");
  hint.style.marginTop = "24px";
  hint.textContent = "Tap anywhere to reload";
  display.appendChild(hint);
}, 60000);

const loadMain = () => import("./main");

const attempt = (retriesLeft: number): void => {
  loadMain()
    .then(() => {
      settled = true;
      window.clearInterval(heartbeat);
      // Startup succeeded — remove the status overlay so it cannot cover the
      // live app surface.
      hideStatus();
    })
    .catch((error: unknown) => {
      // One automatic retry: a transient WebKit/proxy hiccup during the large
      // graph fetch must not surface as a fatal startup error.
      if (retriesLeft > 0 && !settled) {
        window.setTimeout(() => attempt(retriesLeft - 1), 1500);
        return;
      }
      settled = true;
      window.clearInterval(heartbeat);
      console.error("[startup] main module failed to load:", error);
      const reason =
        error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      showStatus(`Startup failed:\n${reason}`);
    });
};

attempt(1);

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
const setStartupDiagnostic = (message: string) => {
  const display = document.getElementById("error-display");
  if (!display) return;
  display.textContent = message;
  display.style.display = "block";
};

const importWithStartupTimeout = async (name: string, load: () => Promise<unknown>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`startup stage timed out: ${name}`)), 5000);
  });
  try {
    await Promise.race([load(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const startupStages: Array<[string, () => Promise<unknown>]> = [
  ["brandMigration", () => import("./lib/brandMigration")],
  ["fonts", () => import("./utils/fonts")],
  ["index.css", () => import("./index.css")],
  ["mobile.css", () => import("./styles/mobile.css")],
  ["router", () => import("react-router-dom")],
  ["query", () => import("@tanstack/react-query")],
  ["theme", () => import("./contexts/ThemeContext")],
  ["pwa", () => import("./lib/pwa")],
  ["tauri", () => import("./lib/tauri")],
  ["networkDebug", () => import("./debug/networkDebug")],
  ["logcatBridge", () => import("./lib/consoleLogcatBridge")],
  ["battery", () => import("./contexts/BatteryContext")],
  ["presentation", () => import("./contexts/PresentationContext")],
  ["languageProfile", () => import("./contexts/LanguageProfileContext")],
];

const clearStartupDiagnostic = () => {
  const display = document.getElementById("error-display");
  if (!display) return;
  display.textContent = "";
  display.style.display = "none";
};

void (async () => {
  for (const [name, load] of startupStages) {
    setStartupDiagnostic(`Startup stage: ${name}`);
    await importWithStartupTimeout(name, load);
  }
  setStartupDiagnostic("Startup stage: main");
  await importWithStartupTimeout("main", () => import("./main"));
  // Startup succeeded — remove the diagnostic overlay so it cannot cover
  // the live app surface.
  clearStartupDiagnostic();
})().catch((error) => {
  console.error("[startup] main module failed to load:", error);
  const reason = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  setStartupDiagnostic(`Startup module failed:\n${reason}`);
});

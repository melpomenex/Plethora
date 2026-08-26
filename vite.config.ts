import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import path from "path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanForForbiddenStoreArtifacts } from "./src/lib/storeProfileGuard";
import { parseBuildProfile } from "./src/lib/buildProfile";
import { resolveViteBuildTargets, type RuntimeTargetEnv } from "./src/lib/runtimeTarget";
import { writeFileSync } from "node:fs";

// @ts-expect-error process is a nodejs global
const rawHost = process.env.TAURI_DEV_HOST;
// Simulator/desktop development can use loopback. Tauri supplies a public
// address through TAURI_DEV_HOST for physical-device development, where the
// dev server must be reachable from the device.
const host = rawHost === "localhost" ? "0.0.0.0" : (rawHost || "127.0.0.1");

// Build profile (Change A §3.2): development | sideload | store. Consumed
// read-only by src/lib/buildProfile.ts (Proposals B and D import from there).
// @ts-expect-error process is a nodejs global
const buildProfile = parseBuildProfile(process.env.PLETHORA_BUILD_PROFILE);
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
let gitSha = process.env.VITE_GIT_SHA?.trim();
if (!gitSha) {
  try {
    gitSha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    gitSha = "unknown";
  }
}
const appBuildId = process.env.VITE_MARKETING_BUILD_ID?.trim() || `${appVersion}+${gitSha}`;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = process.env as RuntimeTargetEnv;
  const { runtimeTarget, isTauriBuild, isPWA, isProd } = resolveViteBuildTargets(env, mode);

  const plugins = [
    react({ fastRefresh: !isTauriBuild }),
    tailwindcss(),
    wasm(),
    // Store-profile guard (Change A §3.3): a store build hard-fails if any
    // emitted chunk references dev/loopback endpoints.
    {
      name: "plethora-store-profile-guard",
      writeBundle(_options, bundle) {
        if (buildProfile !== "store") return;
        const violations: string[] = [];
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type === "chunk") {
            violations.push(...scanForForbiddenStoreArtifacts(chunk.code, fileName));
          }
        }
        if (violations.length > 0) {
          throw new Error(
            `PLETHORA_BUILD_PROFILE=store: forbidden dev/test artifacts in bundle:\n` +
              violations.join("\n")
          );
        }
      },
    },
    {
      name: "plethora-build-metadata",
      writeBundle() {
        const metadata = {
          target: runtimeTarget,
          profile: buildProfile,
          version: appVersion,
          gitSha,
          buildId: appBuildId,
          builtAt: new Date().toISOString(),
        };
        writeFileSync(
          path.resolve(__dirname, "dist/plethora-build-metadata.json"),
          `${JSON.stringify(metadata, null, 2)}\n`,
          "utf8"
        );
      },
    },
  ];

  return {
    plugins,
    // Bundle workers as ES modules. Every `new Worker(...)` in the app already
    // passes { type: "module" }, and the PDF.js bootstrap worker
    // (src/workers/pdfjs.worker.ts) must keep its `export *` of
    // WorkerMessageHandler so it can double as GlobalWorkerOptions.workerSrc
    // for the same-thread fake-worker fallback (the default "iife" format
    // strips module exports).
    worker: {
      format: "es" as const,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom"],
    },

    // Use relative asset paths so the production build works with
    // Tauri's custom protocol and when opening the file directly.
    // Always use relative paths to avoid CORS issues with dynamic imports.
    base: isProd ? "./" : "/",

    define: {
      __PWA_MODE__: JSON.stringify(isPWA),
      __PLETHORA_RUNTIME_TARGET__: JSON.stringify(runtimeTarget),
      __PLETHORA_BUILD_PROFILE__: JSON.stringify(buildProfile),
      __PLETHORA_APP_VERSION__: JSON.stringify(appVersion),
      __PLETHORA_GIT_SHA__: JSON.stringify(gitSha),
      __PLETHORA_BUILD_ID__: JSON.stringify(appBuildId),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 15173,
      strictPort: true,
      host: host || "127.0.0.1",
      // Force HMR to a fixed port to avoid handshake issues in the Tauri webview.
      // Disable HMR entirely for PWA mode to avoid websocket churn in installed builds.
      hmr: isTauriBuild || isPWA
        ? false
        : {
          protocol: "ws",
          host: host || "127.0.0.1",
        },
      // In Tauri, disable the websocket server entirely to stop client WS attempts.
      ws: isTauriBuild ? false : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        // Keep the watcher set small; this repo contains large non-frontend trees.
        ignored: [
          "**/src-tauri/**",
          "**/server/**",
          "**/whisper.cpp/**",
          "**/transcript-tester/**",
          "**/api/**",
          "**/browser_extension/**",
          "**/docs/**",
          "**/dist/**",
          "**/demo/**",
          "**/vps-service/**",
        ],
      },
      // Proxy API requests in development
      proxy: isPWA
        ? {
          "/api": {
            target: "http://localhost:3000",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ""),
          },
        }
        : undefined,
    },

    // Performance: Code splitting optimization
    build: {
      sourcemap: false,
      // For PWA, we can use normal code splitting
      // For Tauri, inline everything to avoid CORS issues with dynamic imports
      // The iOS Tauri custom protocol does not reliably settle Vite's
      // dependency-preload promise for a large dynamic entry. Let native
      // module imports load their own dependencies after bootstrap instead.
      modulePreload: isPWA,
      cssCodeSplit: true,
      rollupOptions: {
        // Externalize Tauri-specific modules that are only available in Tauri builds
        external: isPWA ? ["@tauri-apps/plugin-fs", "@tauri-apps/plugin-dialog", "@tauri-apps/api/path"] : [],
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
              return "react-vendor";
            }
            if (id.includes("node_modules/@tanstack/react-query") || id.includes("node_modules/@tanstack/react-virtual")) {
              return "query-vendor";
            }
            if (id.includes("node_modules/pdfjs-dist")) {
              return "pdf-vendor";
            }
            if (id.includes("node_modules/epubjs")) {
              return "epub-vendor";
            }
            if (id.includes("node_modules/@phosphor-icons")) {
              return "ui-vendor";
            }
            if (id.includes("node_modules/zustand")) {
              return "zustand";
            }
            if (id.includes("node_modules/three")) {
              return "three-vendor";
            }
            if (id.includes("node_modules/@huggingface/transformers")) {
              return "transformers-vendor";
            }
            if (id.includes("node_modules/tesseract.js") || id.includes("node_modules/tesseract.js-core")) {
              return "ocr-vendor";
            }
            if (id.includes("node_modules/recharts")) {
              return "charts-vendor";
            }
            if (id.includes("node_modules/katex")) {
              return "katex-vendor";
            }
            if (id.includes("node_modules/yjs") || id.includes("node_modules/y-websocket") || id.includes("node_modules/y-indexeddb") || id.includes("node_modules/lib0") || id.includes("node_modules/y-protocols") || id.includes("node_modules/y-map")) {
              return "yjs-vendor";
            }
            if (id.includes("node_modules/sql.js")) {
              return "sql-vendor";
            }
            if (id.includes("node_modules/hash-wasm")) {
              return "hash-vendor";
            }
            if (id.includes("node_modules/react-markdown") || id.includes("node_modules/dompurify")) {
              return "markdown-vendor";
            }
            // Article import pipeline engines (defuddle + @mozilla/readability).
            // Loaded only via cached dynamic import() on first URL import, so
            // app startup never executes them; PWA builds isolate them here.
            if (id.includes("node_modules/defuddle") || id.includes("node_modules/@mozilla/readability")) {
              return "article-vendor";
            }
            if (id.includes("node_modules/jszip")) {
              return "zip-vendor";
            }
            if (id.includes("node_modules/@dqbd/tiktoken")) {
              return "tiktoken-vendor";
            }
            if (id.includes("features/help")) {
              return "help-bundle";
            }
            return undefined;
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    optimizeDeps: {
      force: false,
      // The repository contains standalone browser-extension and WASM demo
      // HTML files with stale /node_modules/.vite imports. They are not part
      // of the Tauri app and can abort dependency optimization before the
      // bootstrap module is served.
      entries: ["index.html"],
      include: [
        "@dqbd/tiktoken",
        "@mozilla/readability",
        "@phosphor-icons/react",
        "@tanstack/react-query",
        "@tanstack/react-virtual",
        "@tauri-apps/api/app",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/api/path",
        "@tauri-apps/api/webviewWindow",
        "@tauri-apps/api/window",
        "@tauri-apps/plugin-deep-link",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-log",
        "@tauri-apps/plugin-opener",
        "@tauri-apps/plugin-os",
        "@tauri-apps/plugin-process",
        "@tauri-apps/plugin-updater",
        "@vercel/analytics/react",
        "class-variance-authority",
        "clsx",
        "defuddle",
        "dompurify",
        "epubjs",
        "idb",
        "jszip",
        "katex",
        "pdfjs-dist",
        "pdfjs-dist/build/pdf.worker.min.mjs",
        "pdfjs-dist/web/pdf_viewer.mjs",
        "react",
        "react-dom",
        "react-dom/client",
        "react-markdown",
        "react-router-dom",
        "react-youtube",
        "recharts",
        "sql.js",
        "tailwind-merge",
        "tesseract.js",
        "three",
        "ts-fsrs",
        "uuid",
        "zustand",
        "zustand/middleware",
        "zustand/react/shallow",
      ],
      esbuildOptions: {
        sourcemap: false,
        plugins: [],
      },
    },
  };
});

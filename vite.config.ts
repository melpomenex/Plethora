import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import path from "path";

// @ts-expect-error process is a nodejs global
const rawHost = process.env.TAURI_DEV_HOST;
const host = rawHost === "localhost" ? "0.0.0.0" : (rawHost || "0.0.0.0");

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const isProd = mode === "production";
  const isTauriBuild = Boolean(
    process.env.PLETHORA_TAURI ||
    process.env.INCREMENTUM_TAURI ||
      process.env.TAURI_DEV_HOST ||
      process.env.TAURI_PLATFORM ||
      process.env.TAURI_ARCH ||
      process.env.TAURI_FAMILY
  );
  const isPWA = mode === "pwa" || (!isTauriBuild && isProd);

  const plugins = [
    react({ fastRefresh: !isTauriBuild }),
    tailwindcss(),
    wasm(),
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
      modulePreload: true,
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
      include: [
        "jszip",
        "react",
        "react-dom",
        "dompurify",
        "zustand",
        "react-markdown",
        "katex",
        "recharts",
        "yjs",
        "sql.js",
      ],
      esbuildOptions: {
        sourcemap: false,
        plugins: [],
      },
    },
  };
});

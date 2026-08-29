import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    __PLETHORA_RUNTIME_TARGET__: JSON.stringify("web"),
    __PLETHORA_BUILD_PROFILE__: JSON.stringify("development"),
    __PLETHORA_APP_VERSION__: JSON.stringify("0.0.0-test"),
    __PLETHORA_GIT_SHA__: JSON.stringify("test"),
    __PLETHORA_BUILD_ID__: JSON.stringify("test"),
    __PWA_MODE__: JSON.stringify(false),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/dist/**",
        "src-tauri/**",
      ],
    },
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: [
      "node_modules/",
      "src-tauri/",
      "dist/",
      // Benchmarks belong to `npm run bench` (vitest.bench.config.ts), never to
      // the unit run. `.tsx` covers the jsdom render-cost lane.
      "src/**/*.bench.ts",
      "src/**/*.bench.tsx",
      // Playwright visual suites run via `npm run test:visual`, not vitest.
      "src/visual/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

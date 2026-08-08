import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Benchmark harness config — `npm run bench`.
 *
 * Benchmarks measure hot paths, so the jsdom environment and the test setup
 * file (DOM shims, Tauri mocks, PDF mocks) must NOT be loaded: they add
 * startup cost and unpredictable timing. This config runs in plain Node and
 * executes one benchmark file at a time (`pool: "forks"` +
 * `fileParallelism: false`) so suites never contend for CPU with each other.
 *
 * Node stays the default, but a benchmark that measures React render cost has
 * nothing to render into. Such a file opts *itself* into jsdom with a
 * `// @vitest-environment jsdom` docblock and imports `src/test/bench-dom-setup`
 * for its shims — per file, so no Node benchmark gains a DOM or a setup cost it
 * did not ask for, and `src/test/setup.ts` is still never loaded here. Those
 * files are `.bench.tsx` (they need JSX), hence the two-extension glob below.
 *
 * Results are written to `.bench/results.json` by the `--outputJson` flag in
 * the npm script; `scripts/check-perf-budget.mjs` turns them into a pass/fail.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    isolate: true,
    setupFiles: ["./src/test/bench-setup.ts"],
    benchmark: {
      include: ["src/**/*.bench.{ts,tsx}"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

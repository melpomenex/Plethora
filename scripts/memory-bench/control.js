/**
 * Control server for the memory benchmark (task 3.4, protocol half).
 *
 * The driver serves three endpoints on a loopback port:
 *   GET  /manifest?run=<runId>  → corpus manifest (corpusId -> fileName)
 *   GET  /step?run=<runId>      → long-poll; the next pending step, 204 when
 *                                 nothing is pending, { done: true } when the
 *                                 scenario is over
 *   POST /report?run=<runId>    → the app's step completion report
 *
 * Steps are pushed by the driver and handed to the app one at a time in order;
 * reports are matched by step number. The runId must match the one the driver
 * launched the app with (design D3 marker semantics).
 */

import { createServer } from "node:http";

/**
 * @param {object} options
 * @param {string} options.runId
 * @param {() => object} options.getManifest
 * @param {number} [options.pollHoldMs=30000] how long a /step long-poll waits
 *   for a pending step before answering 204.
 */
export function createControlServer({ runId, getManifest, pollHoldMs = 30_000 }) {
  const pendingSteps = []; // FIFO of { step, resolve }
  const waiters = []; // pending /step requests awaiting a step
  const reports = new Map(); // step -> report
  const reportWaiters = new Map(); // step -> [resolve]
  let finished = false;
  let finishReason = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.get("run") !== runId) {
      console.error(`[control] REJECTED ${req.method} ${url.pathname} (run id mismatch)`);
      res.writeHead(403).end("run id mismatch");
      return;
    }
    const path = url.pathname;
    if (req.method === "GET" && path === "/manifest") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getManifest()));
      return;
    }
    if (req.method === "GET" && path === "/step") {
      if (finished) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ done: true, reason: finishReason }));
        return;
      }
      const pending = pendingSteps.shift();
      if (pending) {
        console.error(`[control] /step -> ${pending.step.step} (${pending.step.op})`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ step: pending.step }));
        pending.resolve();
        return;
      }
      // Long-poll: hold the response until a step is pushed or the hold elapses.
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(entry);
        if (idx >= 0) waiters.splice(idx, 1);
        console.error(`[control] /step hold elapsed (204) — ${waiters.length} waiter(s) remain`);
        res.writeHead(204).end();
      }, pollHoldMs);
      const entry = { res, timer };
      waiters.push(entry);
      req.on("close", () => {
        if (waiters.includes(entry)) {
          console.error("[control] /step wait aborted by client before hold elapsed");
        }
      });
      return;
    }
    if (req.method === "POST" && path === "/report") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on("end", () => {
        try {
          const report = JSON.parse(body);
          if (typeof report.step !== "number") {
            res.writeHead(400).end("report.step must be a number");
            return;
          }
          console.error(`[control] /report step=${report.step} status=${report.status}${report.error ? ` error=${String(report.error).slice(0, 200)}` : ""}`);
          reports.set(report.step, report);
          const waitersForStep = reportWaiters.get(report.step) ?? [];
          reportWaiters.delete(report.step);
          for (const resolve of waitersForStep) resolve(report);
          res.writeHead(200).end("ok");
        } catch {
          res.writeHead(400).end("invalid JSON");
        }
      });
      return;
    }
    res.writeHead(404).end();
  });

  /** Push a step for the app to consume. Resolves when the app picked it up. */
  function pushStep(step) {
    return new Promise((resolve) => {
      pendingSteps.push({ step, resolve });
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.res.writeHead(200, { "content-type": "application/json" });
        waiter.res.end(JSON.stringify({ step }));
        resolve();
      }
    });
  }

  /** Wait for the app's report for a step, or reject on timeout. */
  function waitForReport(step, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const existing = reports.get(step);
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        const list = reportWaiters.get(step) ?? [];
        const idx = list.indexOf(resolve);
        if (idx >= 0) list.splice(idx, 1);
        reject(new Error(`no report for step ${step} within ${timeoutMs}ms`));
      }, timeoutMs);
      reportWaiters.set(step, [...(reportWaiters.get(step) ?? []), (report) => {
        clearTimeout(timer);
        resolve(report);
      }]);
    });
  }

  function finish(reason = null) {
    finished = true;
    finishReason = reason;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.res.writeHead(200, { "content-type": "application/json" });
      waiter.res.end(JSON.stringify({ done: true, reason }));
    }
  }

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve({
            url: `http://127.0.0.1:${address.port}`,
            port: address.port,
          });
        });
      }),
    pushStep,
    waitForReport,
    finish,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
    get reports() {
      return reports;
    },
  };
}

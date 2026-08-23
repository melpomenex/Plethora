import assert from "node:assert/strict";
import test from "node:test";
import { assertCapturePageIntegrity } from "../marketing/capture-integrity.mjs";

const options = {
  scene: { id: "library.ready", actions: [] },
  layout: "desktop",
  catalog: { metadata: { fixtureHash: "a".repeat(64), fixtureVersion: "2.0.0" } },
  buildId: "2.7.0+abcdef123456",
  fixtureTitles: ["Why highlighting feels like learning"],
  captureOrigin: "http://127.0.0.1:15173",
};

test("accepts a page that reports clean capture integrity", async () => {
  const page = { evaluate: async () => ({ problems: [], identity: { buildId: options.buildId } }) };
  await assert.doesNotReject(() => assertCapturePageIntegrity(page, { ...options, requestUrls: ["http://127.0.0.1:15173/src/main.tsx"] }));
});

test("rejects external requests before capture", async () => {
  const page = { evaluate: async () => ({ problems: [] }) };
  await assert.rejects(
    () => assertCapturePageIntegrity(page, { ...options, requestUrls: ["https://tracker.example/pixel"] }),
    /unexpected request domains/,
  );
});

test("rejects product DOM integrity failures", async () => {
  const page = { evaluate: async () => ({ problems: ["visible skeleton", "fixture hash mismatch"] }) };
  await assert.rejects(
    () => assertCapturePageIntegrity(page, { ...options, requestUrls: [] }),
    /visible skeleton; fixture hash mismatch/,
  );
});

#!/usr/bin/env node
/**

 Integration test for the delta-log sync service (design.md §4, tasks
 3.1-3.9). Standalone Node script (not a test runner) so it can spawn a
 real server process, matching the style of yjs-sync/test/*.cjs.

 Run: node yjs-sync/file-service/test/sync-log.mjs

*/

import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "index.js");

function pickPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

function waitForReady(port, attemptsLeft = 100) {
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (attemptsLeft <= 0) reject(new Error("server never became ready"));
        else setTimeout(() => waitForReady(port, attemptsLeft - 1).then(resolve, reject), 100);
      });
    };
    tryConnect();
  });
}

async function withServer(fn) {
  const port = pickPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-log-test-"));
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      FILES_DATA_DIR: path.join(dataDir, "files"),
      SYNC_LOG_DB_PATH: path.join(dataDir, "sync-log.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (c) => stderr.push(c));
  child.stdout.on("data", () => {});

  try {
    await waitForReady(port);
    return await fn(port);
  } finally {
    child.kill("SIGTERM");
    if (stderr.length) process.stderr.write(Buffer.concat(stderr).toString());
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// --- signing helpers, mirroring src/lib/sync/encryption.ts::signRequest ---

function buildSignedMessage(method, path, body, timestamp) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  return Buffer.concat([
    Buffer.from(method.toUpperCase(), "utf8"),
    Buffer.from([0]),
    Buffer.from(path, "utf8"),
    Buffer.from([0]),
    Buffer.from(String(timestamp), "utf8"),
    Buffer.from([0]),
    bodyBuf,
  ]);
}

function sign(key, method, path, body, timestamp = Date.now()) {
  const mac = crypto.createHmac("sha256", key).update(buildSignedMessage(method, path, body, timestamp)).digest("hex");
  return { timestamp, signature: mac };
}

function request(port, method, reqPath, { key, body, roomKey, headers } = {}) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body !== undefined ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
    const hdrs = { "Content-Type": "application/octet-stream", ...(headers || {}) };
    if (key) {
      const { timestamp, signature } = sign(key, method, reqPath, bodyBuf);
      hdrs["X-Sync-Timestamp"] = String(timestamp);
      hdrs["X-Sync-Signature"] = signature;
    }
    if (roomKey) hdrs["X-Sync-Room-Key"] = roomKey.toString("base64");

    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method, headers: hdrs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on("error", reject);
    req.end(bodyBuf);
  });
}

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

async function testAuthRejection(port) {
  const room = "room-auth-reject-01";
  const res = await request(port, "GET", `/rooms/${room}/head`);
  ok(res.status === 401, "unauthenticated request rejected with 401");
}

async function testRegistrationAndAuth(port) {
  const room = "room-register-0000001";
  const key = crypto.randomBytes(32);

  const first = await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });
  ok(first.status === 200, "first request with room key registers and succeeds");
  ok(first.json.head === 0, "fresh room has head=0");

  // Second request: signature alone (no room key needed), should succeed.
  const second = await request(port, "GET", `/rooms/${room}/head`, { key });
  ok(second.status === 200, "subsequent request authenticates via signature alone");

  // Wrong key now rejected (room already registered — TOFU is one-shot).
  const wrongKey = crypto.randomBytes(32);
  const third = await request(port, "GET", `/rooms/${room}/head`, { key: wrongKey });
  ok(third.status === 401, "wrong key rejected after registration");

  // An attacker cannot re-register over an existing room even with a key.
  const hijack = await request(port, "GET", `/rooms/${room}/head`, { key: wrongKey, roomKey: wrongKey });
  ok(hijack.status === 401, "cannot re-register (hijack) an already-registered room");
}

async function testTamperRejection(port) {
  const room = "room-tamper-0000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const { timestamp, signature } = sign(key, "GET", `/rooms/${room}/head`, Buffer.alloc(0));
  const res = await request(port, "GET", `/rooms/${room}/head`, {
    headers: { "X-Sync-Timestamp": String(timestamp), "X-Sync-Signature": signature.replace(/.$/, "0") },
  });
  ok(res.status === 401, "tampered signature rejected");
}

async function testPushPullCompaction(port) {
  const room = "room-compact-000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const keyTag = b64(crypto.randomBytes(32));
  const ops1 = { ops: [{ keyTag, hlc: "0000000000001.000001", kind: 0, blob: b64(Buffer.from("v1")) }] };
  const push1 = await request(port, "POST", `/rooms/${room}/ops`, { key, body: ops1 });
  ok(push1.status === 200, "push accepts an upsert op");
  ok(push1.json.head === 1, "head advances to 1 after first push");

  // A second edit to the SAME entity: server keeps exactly one row.
  const ops2 = { ops: [{ keyTag, hlc: "0000000000002.000001", kind: 0, blob: b64(Buffer.from("v2")) }] };
  const push2 = await request(port, "POST", `/rooms/${room}/ops`, { key, body: ops2 });
  ok(push2.status === 200 && push2.json.head === 2, "seq re-issued on compaction update");

  const pull = await request(port, "GET", `/rooms/${room}/ops?since=0`, { key });
  ok(pull.status === 200, "pull succeeds");
  ok(pull.json.ops.length === 1, "repeated edits to one entity produce exactly one live row");
  ok(
    Buffer.from(pull.json.ops[0].blob, "base64").toString("utf8") === "v2",
    "live row carries the latest value",
  );

  // An older HLC than what's stored must lose (LWW).
  const stale = { ops: [{ keyTag, hlc: "0000000000000.000001", kind: 0, blob: b64(Buffer.from("stale")) }] };
  await request(port, "POST", `/rooms/${room}/ops`, { key, body: stale });
  const pullAfterStale = await request(port, "GET", `/rooms/${room}/ops?since=0`, { key });
  ok(
    Buffer.from(pullAfterStale.json.ops[0].blob, "base64").toString("utf8") === "v2",
    "a stale (older-HLC) op does not overwrite a newer one",
  );
}

async function testAppendExemptFromCompaction(port) {
  const room = "room-append-00000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const keyTag = b64(crypto.randomBytes(32));
  for (let i = 0; i < 3; i++) {
    await request(port, "POST", `/rooms/${room}/ops`, {
      key,
      body: { ops: [{ keyTag, hlc: `000000000000${i}.000001`, kind: 2, blob: b64(Buffer.from(`review-${i}`)) }] },
    });
  }
  const pull = await request(port, "GET", `/rooms/${room}/ops?since=0`, { key });
  ok(pull.json.ops.length === 3, "append (kind=2) ops accumulate rather than compacting by key");
}

async function testCursorAndHeadRoster(port) {
  const room = "room-cursor-0000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const deviceTag = b64(crypto.randomBytes(16));
  const res = await request(port, "POST", `/rooms/${room}/cursor`, {
    key,
    body: { deviceTag, cursor: 5 },
  });
  ok(res.status === 200, "cursor report accepted");

  const head = await request(port, "GET", `/rooms/${room}/head`, { key });
  ok(head.json.devices.length === 1, "head roster reflects the reporting device");
  ok(head.json.devices[0].cursor === 5, "roster carries the reported cursor");
  ok(head.json.devices[0].presenceBlob === null, "no presence blob reported yet -> null, not a decode error");
}

async function testPresenceBlob(port) {
  const room = "room-presence-00000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const deviceTag = b64(crypto.randomBytes(16));
  // Opaque to the server by construction — this test doesn't even pretend
  // it's encrypted, since the server must not care either way.
  const blob = b64(crypto.randomBytes(64));
  await request(port, "POST", `/rooms/${room}/cursor`, {
    key,
    body: { deviceTag, cursor: 1, presenceBlob: blob },
  });

  const head1 = await request(port, "GET", `/rooms/${room}/head`, { key });
  ok(head1.json.devices[0].presenceBlob === blob, "presence blob round-trips through the head roster");

  // A later cursor-only report (no presenceBlob field) must not erase it.
  await request(port, "POST", `/rooms/${room}/cursor`, {
    key,
    body: { deviceTag, cursor: 2 },
  });
  const head2 = await request(port, "GET", `/rooms/${room}/head`, { key });
  ok(head2.json.devices[0].cursor === 2, "cursor-only report still advances the cursor");
  ok(head2.json.devices[0].presenceBlob === blob, "a cursor-only report does not clear a previously-reported presence blob");
}

async function testWsNotification(port) {
  const room = "room-ws-000000000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const { timestamp, signature } = sign(key, "GET", `/rooms/${room}?since=0`, "");
  const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/${room}?since=0&ts=${timestamp}&sig=${signature}`);

  const opened = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  await opened;

  const nextMessage = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WS notification")), 3000);
    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });

  const keyTag = b64(crypto.randomBytes(32));
  await request(port, "POST", `/rooms/${room}/ops`, {
    key,
    body: { ops: [{ keyTag, hlc: "0000000000001.000001", kind: 0, blob: b64(Buffer.from("x")) }] },
  });

  const msg = await nextMessage;
  ok(msg.head === 1, "WS pushes the new head seq after a push, no payload on the socket");
  ws.close();
}

async function testWsAuthRejected(port) {
  const room = "room-ws-reject-0000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/${room}?since=0&ts=${Date.now()}&sig=deadbeef`);
  const rejected = await new Promise((resolve) => {
    ws.on("error", () => resolve(true));
    ws.on("open", () => resolve(false));
    setTimeout(() => resolve(false), 2000);
  });
  ok(rejected, "WS upgrade with a bad signature is rejected");
}

async function testOversizedBodyRejected(port) {
  const room = "room-oversized-0000000001";
  const key = crypto.randomBytes(32);
  await request(port, "GET", `/rooms/${room}/head`, { key, roomKey: key });

  const bigBlob = b64(crypto.randomBytes(9 * 1024 * 1024)); // > 8 MiB cap
  const res = await request(port, "POST", `/rooms/${room}/ops`, {
    key,
    body: { ops: [{ keyTag: b64(crypto.randomBytes(32)), hlc: "0000000000001.000001", kind: 0, blob: bigBlob }] },
  });
  ok(res.status >= 400, "a request exceeding the body cap is rejected, not buffered");
}

async function main() {
  console.log("Spawning file-service (with folded sync-log) and running delta-log tests...");
  await withServer(async (port) => {
    console.log("test: unauthenticated request rejected");
    await testAuthRejection(port);

    console.log("test: trust-on-first-use registration + signature auth");
    await testRegistrationAndAuth(port);

    console.log("test: tampered signature rejected");
    await testTamperRejection(port);

    console.log("test: push/pull with server-side compaction (LWW by key_tag)");
    await testPushPullCompaction(port);

    console.log("test: append ops exempt from compaction");
    await testAppendExemptFromCompaction(port);

    console.log("test: cursor report + head device roster");
    await testCursorAndHeadRoster(port);

    console.log("test: presence blob round-trips and survives a cursor-only report");
    await testPresenceBlob(port);

    console.log("test: WS pushes seq notifications, no payload");
    await testWsNotification(port);

    console.log("test: WS upgrade rejects a bad signature");
    await testWsAuthRejected(port);

    console.log("test: oversized request body rejected");
    await testOversizedBodyRejected(port);
  });
  console.log(`All delta-log sync-log tests passed (${passed} assertions).`);
}

main().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

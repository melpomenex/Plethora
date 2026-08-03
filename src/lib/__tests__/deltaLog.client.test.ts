import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { deriveRoomKey, deriveSubKeys } from "../sync/encryption";
import { push, pull, head, reportCursor, registerRoom, subscribe, type DeltaLogClientConfig } from "../sync/deltaLog/client";
import { buildOp, decodeOp } from "../sync/deltaLog/envelope";

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "yjs-sync", "file-service", "index.js");

function pickPort(): number {
  return 22000 + Math.floor(Math.random() * 8000);
}

function waitForReady(port: number, attemptsLeft = 100): Promise<void> {
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

describe("deltaLog client (end-to-end against the real sync-log server)", () => {
  let child: ChildProcess;
  let port: number;
  let dataDir: string;
  let config: DeltaLogClientConfig;

  beforeAll(async () => {
    port = pickPort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-log-client-test-"));
    child = spawn(process.execPath, [SERVER_PATH], {
      env: {
        ...process.env,
        PORT: String(port),
        FILES_DATA_DIR: path.join(dataDir, "files"),
        SYNC_LOG_DB_PATH: path.join(dataDir, "sync-log.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(port);

    const roomKey = await deriveRoomKey("test-secret", "test-room-client-e2e");
    const subKeys = await deriveSubKeys(roomKey, "test-room-client-e2e");
    config = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "e2eroom00000000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    return () => {
      child.kill("SIGTERM");
      fs.rmSync(dataDir, { recursive: true, force: true });
    };
  }, 15_000);

  afterAll(() => {
    child?.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("push then pull round-trips a raw op", async () => {
    const before = await head(config);
    expect(before.head).toBe(0);

    const pushed = await push(config, [
      { keyTag: btoa("k".repeat(32)), hlc: "0000000000001.000001", kind: 0, blob: btoa("hello") },
    ]);
    expect(pushed.head).toBe(1);

    const page = await pull(config, 0);
    expect(page.ops.length).toBe(1);
    expect(page.ops[0].seq).toBe(1);
  });

  it("reportCursor updates the head roster", async () => {
    await reportCursor(config, btoa("device-1"), 1);
    const after = await head(config);
    const device = after.devices.find((d) => d.deviceTag === btoa("device-1"));
    expect(device?.cursor).toBe(1);
  });

  it("round-trips an envelope-wrapped op through buildOp/push/pull/decodeOp", async () => {
    const roomKey = await deriveRoomKey("test-secret", "test-room-envelope");
    const subKeys = await deriveSubKeys(roomKey, "test-room-envelope");
    const envConfig: DeltaLogClientConfig = {
      ...config,
      room: "envroom000000000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(envConfig);

    const op = await buildOp(
      { domain: "documents", entityKey: "doc-1", operation: "upsert", row: { title: "hi" } },
      "0000000000002.000001",
      subKeys,
    );
    await push(envConfig, [op]);

    const page = await pull(envConfig, 0);
    expect(page.ops.length).toBe(1);
    const decoded = await decodeOp(page.ops[0], subKeys);
    expect(decoded.domain).toBe("documents");
    expect(decoded.entityKey).toBe("doc-1");
    expect(decoded.row).toEqual({ title: "hi" });
  });

  it("subscribe() receives a head notification after a push", async () => {
    const roomKey = await deriveRoomKey("test-secret", "test-room-ws");
    const subKeys = await deriveSubKeys(roomKey, "test-room-ws");
    const wsConfig: DeltaLogClientConfig = {
      ...config,
      room: "wsroom0000000000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(wsConfig);

    const received = new Promise<number>((resolve) => {
      const sub = subscribe(wsConfig, 0, (newHead) => {
        resolve(newHead);
        sub.close();
      });
    });

    // Give the socket a moment to connect before pushing.
    await new Promise((r) => setTimeout(r, 200));
    await push(wsConfig, [{ keyTag: btoa("t".repeat(32)), hlc: "0000000000001.000001", kind: 0, blob: btoa("x") }]);

    const newHead = await received;
    expect(newHead).toBe(1);
  }, 10_000);
});

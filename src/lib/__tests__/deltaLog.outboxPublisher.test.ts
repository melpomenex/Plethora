import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { deriveRoomKey, deriveSubKeys } from "../sync/encryption";
import { registerRoom, pull, type DeltaLogClientConfig } from "../sync/deltaLog/client";
import { decodeOp } from "../sync/deltaLog/envelope";
import { registerDeltaLogOutboxPublishers } from "../sync/deltaLog/outboxPublisher";
import { drainSyncOutboxBatch } from "../sync/syncJournal";

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "yjs-sync", "file-service", "index.js");

function pickPort(): number {
  return 40000 + Math.floor(Math.random() * 8000);
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

describe("deltaLog outbox publisher wiring", () => {
  let child: ChildProcess;
  let dataDir: string;
  let port: number;

  beforeAll(async () => {
    port = pickPort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-log-outbox-test-"));
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
  }, 15_000);

  afterAll(() => {
    child?.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("drainSyncOutboxBatch publishes a pending row to the delta-log server via the registered publisher", async () => {
    const roomKey = await deriveRoomKey("test-secret", "test-room-outbox");
    const subKeys = await deriveSubKeys(roomKey, "test-room-outbox");
    const config: DeltaLogClientConfig = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "outboxroom00000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    const unregister = registerDeltaLogOutboxPublishers(["documents"], config, subKeys);

    const pendingRow = {
      operation_id: "op-1",
      domain: "documents",
      entity_key: "doc-42",
      operation: "upsert" as const,
      payload: JSON.stringify({ title: "hello" }),
      clock: "0000000000005.000001",
    };
    mocks.invokeCommand.mockImplementation(async (command: string) => {
      if (command === "get_sync_outbox") return [pendingRow];
      if (command === "mark_sync_outbox_sent") return 1;
      return null;
    });

    const result = await drainSyncOutboxBatch(10);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    const page = await pull(config, 0);
    expect(page.ops.length).toBe(1);
    const decoded = await decodeOp(page.ops[0], subKeys);
    expect(decoded.domain).toBe("documents");
    expect(decoded.entityKey).toBe("doc-42");
    expect(decoded.row).toEqual({ title: "hello" });

    unregister();
  });
});

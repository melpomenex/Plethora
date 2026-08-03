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
import { push, registerRoom, type DeltaLogClientConfig } from "../sync/deltaLog/client";
import { buildOp } from "../sync/deltaLog/envelope";
import { runDeltaLogPullLoop } from "../sync/deltaLog/pullLoop";
import { resetProgressiveSyncSchedulerForTest } from "../sync/progressiveScheduler";

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "yjs-sync", "file-service", "index.js");

function pickPort(): number {
  return 31000 + Math.floor(Math.random() * 8000);
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

describe("deltaLog pull loop (against the real sync-log server)", () => {
  let child: ChildProcess;
  let dataDir: string;

  beforeAll(async () => {
    const port = pickPort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-log-pullloop-test-"));
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
    (globalThis as { __testPort?: number }).__testPort = port;
  }, 15_000);

  afterAll(() => {
    child?.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    resetProgressiveSyncSchedulerForTest();
  });

  it("pages through a room's ops and checkpoints after each page", async () => {
    const port = (globalThis as { __testPort?: number }).__testPort!;
    const roomKey = await deriveRoomKey("test-secret", "test-room-pullloop");
    const subKeys = await deriveSubKeys(roomKey, "test-room-pullloop");
    const config: DeltaLogClientConfig = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "pullrooma000000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    // Seed 3 ops on the server before the client ever pulls.
    for (let i = 0; i < 3; i++) {
      const op = await buildOp(
        { domain: "documents", entityKey: `doc-${i}`, operation: "upsert", row: { i } },
        `000000000000${i}.000001`,
        subKeys,
      );
      await push(config, [op]);
    }

    // No checkpoint persisted yet -> pull loop must start from cursor 0.
    let checkpointStore: Record<string, string> = {};
    mocks.invokeCommand.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "get_sync_checkpoint") {
        const cursor = checkpointStore[args.domain as string];
        return cursor ? { domain: args.domain, cursor } : null;
      }
      if (command === "set_sync_checkpoint") {
        checkpointStore[args.domain as string] = args.cursor as string;
        return { domain: args.domain, cursor: args.cursor };
      }
      return null;
    });

    const applied: unknown[] = [];
    const result = await runDeltaLogPullLoop(config, async (ops) => {
      applied.push(...ops);
    });

    expect(result.pagesApplied).toBe(1);
    expect(applied.length).toBe(3);
    expect(result.finalCursor).toBe(3);
    expect(checkpointStore["deltaLog:room"]).toBe("3");
  }, 15_000);

  it("resumes from a persisted cursor instead of restarting cold start", async () => {
    const port = (globalThis as { __testPort?: number }).__testPort!;
    const roomKey = await deriveRoomKey("test-secret", "test-room-resume");
    const subKeys = await deriveSubKeys(roomKey, "test-room-resume");
    const config: DeltaLogClientConfig = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "resumeroom00000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    for (let i = 0; i < 2; i++) {
      const op = await buildOp(
        { domain: "documents", entityKey: `doc-${i}`, operation: "upsert", row: { i } },
        `000000000000${i}.000001`,
        subKeys,
      );
      await push(config, [op]);
    }

    // Simulate a prior run that already checkpointed past seq 1.
    const checkpointStore: Record<string, string> = { "deltaLog:room": "1" };
    mocks.invokeCommand.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "get_sync_checkpoint") {
        const cursor = checkpointStore[args.domain as string];
        return cursor ? { domain: args.domain, cursor } : null;
      }
      if (command === "set_sync_checkpoint") {
        checkpointStore[args.domain as string] = args.cursor as string;
        return { domain: args.domain, cursor: args.cursor };
      }
      return null;
    });

    const applied: unknown[] = [];
    const result = await runDeltaLogPullLoop(config, async (ops) => {
      applied.push(...ops);
    });

    // Only the second op (seq=2) should be re-delivered, not the first.
    expect(applied.length).toBe(1);
    expect(result.finalCursor).toBe(2);
  }, 15_000);
});

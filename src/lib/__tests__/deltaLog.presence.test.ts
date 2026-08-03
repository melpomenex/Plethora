import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";

import { deriveRoomKey, deriveSubKeys } from "../sync/encryption";
import { registerRoom, type DeltaLogClientConfig } from "../sync/deltaLog/client";
import { FileManifest } from "../file-manifest";
import * as Y from "yjs";

const SERVER_PATH = path.join(__dirname, "..", "..", "..", "yjs-sync", "file-service", "index.js");

function pickPort(): number {
  return 50000 + Math.floor(Math.random() * 8000);
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

describe("device presence via the delta-log server (task 5.6)", () => {
  let child: ChildProcess;
  let dataDir: string;
  let port: number;

  beforeAll(async () => {
    port = pickPort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-log-presence-test-"));
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

  it("reportPresenceViaDeltaLog + getOnlineDevicesViaDeltaLog round-trip an encrypted hasFiles list", async () => {
    const roomKey = await deriveRoomKey("secret", "room-presence-e2e");
    const subKeys = await deriveSubKeys(roomKey, "room-presence-e2e");
    const config: DeltaLogClientConfig = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "presenceroom0000000001",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    localStorage.setItem("incrementum_device_id", "device-alpha");
    const manifest = new FileManifest(new Y.Doc());

    await manifest.reportPresenceViaDeltaLog(config, subKeys.fileKey, ["file-1", "file-2"], 3);

    const devices = await FileManifest.getOnlineDevicesViaDeltaLog(config, subKeys.fileKey);
    expect(devices.length).toBe(1);
    expect(devices[0].deviceId).toBe("device-alpha");
    expect(devices[0].hasFiles).toEqual(["file-1", "file-2"]);
  });

  it("the server cannot read the presence payload — a wrong fileKey fails to decode it, not a network error", async () => {
    const roomKey = await deriveRoomKey("secret", "room-presence-wrongkey");
    const subKeys = await deriveSubKeys(roomKey, "room-presence-wrongkey");
    const config: DeltaLogClientConfig = {
      httpBase: `http://127.0.0.1:${port}`,
      wsBase: `ws://127.0.0.1:${port}`,
      room: "presenceroom0000000002",
      manifestAuthKey: subKeys.manifestAuthKey,
    };
    await registerRoom(config);

    localStorage.setItem("incrementum_device_id", "device-beta");
    const manifest = new FileManifest(new Y.Doc());
    await manifest.reportPresenceViaDeltaLog(config, subKeys.fileKey, ["secret-file"], 1);

    const wrongRoomKey = await deriveRoomKey("different-secret", "room-presence-wrongkey");
    const wrongSubKeys = await deriveSubKeys(wrongRoomKey, "room-presence-wrongkey");
    const devices = await FileManifest.getOnlineDevicesViaDeltaLog(config, wrongSubKeys.fileKey);
    // Undecodable under the wrong key -> omitted, not thrown and not leaked.
    expect(devices).toEqual([]);
  });
});

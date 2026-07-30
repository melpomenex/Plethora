import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";

/**
 * Scan-to-join wiring tests for SyncSettings.
 *
 * These exercise the real handleJoinRoom logic through the SyncQrScanner
 * mock: when the scanner "detects" a value, the component should parse it,
 * write the room id, and call rejoinRoom — with no manual "Join" tap and no
 * reload. The heavy dependencies (y-websocket replication, yjsSync internals,
 * the settings store, the legacy sync API, QR rendering) are mocked so we test
 * the join orchestration in isolation.
 */

// Capture the most recently rendered SyncQrScanner's onDetected so a test can
// simulate a scan by invoking it.
let lastOnDetected: ((value: string) => Promise<boolean> | boolean) | null = null;

// vi.hoisted() runs before vi.mock factory execution, so the mocks defined here
// are available inside the (hoisted) vi.mock factories below.
const mocks = vi.hoisted(() => {
  return {
    scanner: vi.fn(),
    setSyncRoomId: vi.fn(),
    rejoinRoom: vi.fn().mockResolvedValue({
      doc: {},
      provider: {},
      persistence: null,
      url: "wss://example",
      room: "",
      encrypted: false,
    }),
    getSyncRoomId: vi.fn().mockReturnValue("initial-room-1234"),
    createNewSyncRoomId: vi.fn().mockReturnValue("rotated-room"),
    enableEncryptionWithSecret: vi.fn().mockResolvedValue(undefined),
    // isNativeMobile controls whether the Scan button renders. The scan-to-join
    // UI is for camera-bearing devices, so the tests simulate a native mobile
    // build (isNativeMobile = true) to exercise the scanner flow.
    isNativeMobile: vi.fn().mockReturnValue(true),
    isPWA: vi.fn().mockReturnValue(false),
    // Captures the fire-and-forget startSyncSubsystems() call the join handler
    // makes so a test can assert it was invoked.
    startSyncSubsystems: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../SyncQrScanner", () => ({
  SyncQrScanner: mocks.scanner.mockImplementation((props: {
    onDetected: (v: string) => Promise<boolean> | boolean;
    onClose: () => void;
  }) => {
    // Capture on every render so the test uses the live callback. onClose is
    // exercised by the real component (it sets showScanner=false); we don't
    // assert on it here.
    lastOnDetected = props.onDetected;
    return React.createElement("div", { "data-testid": "mock-scanner" });
  }),
}));

vi.mock("../../../lib/yjsSync", () => ({
  setSyncRoomId: mocks.setSyncRoomId,
  getSyncRoomId: mocks.getSyncRoomId,
  createNewSyncRoomId: mocks.createNewSyncRoomId,
  rejoinRoom: mocks.rejoinRoom,
}));

vi.mock("../../../lib/sync/roomCrypto", () => ({
  enableEncryption: vi.fn().mockResolvedValue("generated-secret"),
  enableEncryptionWithSecret: mocks.enableEncryptionWithSecret,
  // Encryption is always on; the mount effect calls ensureEncryptionEnabled to
  // provision/load a secret for the QR. Resolve with a stable value so the
  // QR payload branch renders without driving real crypto.
  ensureEncryptionEnabled: vi.fn().mockResolvedValue("auto-secret"),
  getCachedRoomSecretOrNull: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../lib/tauri", () => ({
  isNativeMobile: mocks.isNativeMobile,
  isPWA: mocks.isPWA,
  // A native mobile build is also a Tauri build (the Android/iOS webview is
  // hosted by Tauri). The join handler only starts the sync subsystems when
  // isTauri() is true, so the mock must reflect that for the scan-to-join
  // (mobile) path to exercise the wiring.
  isTauri: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../lib/startSyncSubsystems", () => ({
  // The join flow calls startSyncSubsystems() fire-and-forget. Capture the call
  // so a test can assert mobile-style "bring replication up on join" behavior
  // without depending on the real (heavy) sync chain.
  startSyncSubsystems: mocks.startSyncSubsystems,
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    // Include yjs.enabled so the real-time-sync toggle renders without crashing.
    settings: { sync: { autoDownloadMode: "wifi-only", yjs: { enabled: false } } },
    updateSettings: vi.fn(),
  }),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => null,
}));

import { SyncSettings } from "../SyncSettings";

beforeEach(() => {
  vi.clearAllMocks();
  lastOnDetected = null;
  localStorage.clear();
});

async function renderToScanner() {
  render(React.createElement(SyncSettings));
}

describe("SyncSettings scan-to-join", () => {
  it("keeps diagnostics collapsed until the user asks for details", () => {
    render(React.createElement(SyncSettings));

    const diagnosticsToggle = screen.getByRole("button", { name: /syncSettings\.diagnosticsTitle/i });
    expect(diagnosticsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(diagnosticsToggle);

    expect(diagnosticsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/syncSettings\.diagnosticsShowingAll/i)).toBeInTheDocument();
  });

  it("copies the full diagnostics report without expanding the details", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(React.createElement(SyncSettings));

    fireEvent.click(screen.getByRole("button", { name: /syncSettings\.copyDiagnostics/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("table")).toBeNull();
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(
      expect.objectContaining({ telemetry: expect.any(Array), startupRequestCounts: expect.any(Object) }),
    );
  });

  it("joins a scanned full invite code without a manual Join tap", async () => {
    // Simulate a native mobile build so the Scan button renders.
    mocks.isNativeMobile.mockReturnValue(true);

    render(React.createElement(SyncSettings));

    // Click the Scan button to mount the (mocked) scanner.
    const scanButtons = screen.getAllByRole("button", { name: /scan/i });
    await act(async () => {
      scanButtons[0]?.click();
    });

    await waitFor(() => expect(lastOnDetected).not.toBeNull());

    // Simulate a scan of a full invite payload (room + secret). Encryption is
    // mandatory, so this is the only form that can join a room — a bare room
    // id would provision a different key and never decrypt peer frames.
    const roomId = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const invite = `incrementum-sync:v1:${roomId}:YWJjZGVmZ2hpamtsbW5vcHFyc3R1dng`;
    let accepted = false;
    await act(async () => {
      accepted = !!(await lastOnDetected!(invite));
    });

    expect(accepted).toBe(true);
    expect(mocks.enableEncryptionWithSecret).toHaveBeenCalledWith(
      roomId,
      expect.any(String),
    );
    expect(mocks.setSyncRoomId).toHaveBeenCalledWith(roomId);
    expect(mocks.rejoinRoom).toHaveBeenCalledWith(roomId, { forceProviderRebuild: true });
    // Joining a room must bring up the replication chain (cards/docs/feeds) so the
    // device actually receives the room's state. This is the mobile bug fix: boot
    // defers the chain, so an explicit sync action has to start it.
    expect(mocks.startSyncSubsystems).toHaveBeenCalled();
  });

  it("rejects a bare room id (no encryption secret) and keeps the scanner open", async () => {
    // Encryption is mandatory, so a bare room id can't join — the device would
    // auto-provision its own key and be unable to decrypt the peer's frames.
    mocks.isNativeMobile.mockReturnValue(true);

    render(React.createElement(SyncSettings));
    const scanButtons = screen.getAllByRole("button", { name: /scan/i });
    await act(async () => {
      scanButtons[0]?.click();
    });
    await waitFor(() => expect(lastOnDetected).not.toBeNull());

    let accepted = true;
    await act(async () => {
      accepted = !!(await lastOnDetected!("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"));
    });

    expect(accepted).toBe(false);
    expect(mocks.setSyncRoomId).not.toHaveBeenCalled();
    expect(mocks.rejoinRoom).not.toHaveBeenCalled();
    expect(mocks.enableEncryptionWithSecret).not.toHaveBeenCalled();
  });

  it("returns false (keeps scanner open) for an empty scanned value", async () => {
    mocks.isNativeMobile.mockReturnValue(true);

    render(React.createElement(SyncSettings));
    const scanButtons = screen.getAllByRole("button", { name: /scan/i });
    await act(async () => {
      scanButtons[0]?.click();
    });
    await waitFor(() => expect(lastOnDetected).not.toBeNull());

    let accepted = true;
    await act(async () => {
      accepted = !!(await lastOnDetected!("   "));
    });

    expect(accepted).toBe(false);
    expect(mocks.setSyncRoomId).not.toHaveBeenCalled();
    expect(mocks.rejoinRoom).not.toHaveBeenCalled();
  });
});

// Silence the unused-warning for the helper while keeping the file readable.
void renderToScanner;

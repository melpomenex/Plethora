import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  getSyncRoomId: vi.fn().mockReturnValue("room-panel-test"),
  getCachedSubKeys: vi.fn().mockResolvedValue(null),
  getCutoverPhase: vi.fn().mockResolvedValue("dual"),
  getSyncCutoverDomainProgress: vi.fn().mockResolvedValue([
    { domain: "documents", drainedCount: 10, seededCount: 10, updatedAt: "2026-01-01T00:00:00.000Z" },
    { domain: "__yjs-activity", drainedCount: 0, seededCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
  ]),
  drainSyncOutboxBatch: vi.fn().mockResolvedValue({ sent: 0, deferred: 0, failed: 0 }),
  runCutoverPhase: vi.fn().mockResolvedValue(undefined),
  retireYjs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: () => undefined }) }));
vi.mock("../../common/Modal", () => ({ useModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { sync: { yjs: { url: "wss://sync.example.org" } } } }),
}));
vi.mock("../../../lib/yjsSync", () => ({ getSyncRoomId: mocks.getSyncRoomId }));
vi.mock("../../../lib/sync/roomCrypto", () => ({ getCachedSubKeys: mocks.getCachedSubKeys }));
vi.mock("../../../lib/sync/cutover", () => ({
  getCutoverPhase: mocks.getCutoverPhase,
  runCutoverPhase: mocks.runCutoverPhase,
  retireYjs: mocks.retireYjs,
}));
vi.mock("../../../lib/sync/syncJournal", () => ({
  getSyncCutoverDomainProgress: mocks.getSyncCutoverDomainProgress,
  drainSyncOutboxBatch: mocks.drainSyncOutboxBatch,
}));

import { DeltaLogMigrationPanel } from "../DeltaLogMigrationPanel";

describe("DeltaLogMigrationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSyncRoomId.mockReturnValue("room-panel-test");
    mocks.getCachedSubKeys.mockResolvedValue(null);
    mocks.getCutoverPhase.mockResolvedValue("dual");
    mocks.getSyncCutoverDomainProgress.mockResolvedValue([
      { domain: "documents", drainedCount: 10, seededCount: 10, updatedAt: "2026-01-01T00:00:00.000Z" },
      { domain: "__yjs-activity", drainedCount: 0, seededCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("shows the current phase and per-domain progress, hiding synthetic bookkeeping domains", async () => {
    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Dual-running/)).toBeInTheDocument());
    expect(screen.getByText("documents")).toBeInTheDocument();
    expect(screen.queryByText("__yjs-activity")).toBeNull();
  });

  it("disables Finish migration until the phase is verified", async () => {
    mocks.getCutoverPhase.mockResolvedValue("dual");
    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Dual-running/)).toBeInTheDocument());
    const button = screen.getByRole("button", { name: /finish migration/i });
    expect(button).toBeDisabled();
  });

  it("enables Finish migration once verified and calls runCutoverPhase on confirm", async () => {
    mocks.getCutoverPhase.mockResolvedValue("verified");

    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Verified/)).toBeInTheDocument());

    const button = screen.getByRole("button", { name: /finish migration/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.runCutoverPhase).toHaveBeenCalledWith("room-panel-test"));
  });

  it("only shows the retire section once the phase is quiesced", async () => {
    mocks.getCutoverPhase.mockResolvedValue("dual");
    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Dual-running/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retire old sync/i })).toBeNull();
  });

  it("shows the retire section, gated on the backup checkbox, when quiesced", async () => {
    mocks.getCutoverPhase.mockResolvedValue("quiesced");
    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Quiesced/)).toBeInTheDocument());

    const retireButton = screen.getByRole("button", { name: /retire old sync/i });
    expect(retireButton).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(retireButton).not.toBeDisabled();
  });

  it("retry pending operations calls drainSyncOutboxBatch", async () => {
    render(React.createElement(DeltaLogMigrationPanel));
    await waitFor(() => expect(screen.getByText(/Dual-running/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /retry pending operations/i }));
    await waitFor(() => expect(mocks.drainSyncOutboxBatch).toHaveBeenCalled());
  });
});

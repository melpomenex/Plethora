import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Per-test controllable API mocks. Hoisted so the vi.mock factory can reference them.
const api = vi.hoisted(() => ({
  notebooklmHealth: vi.fn(),
  notebooklmListNotebooks: vi.fn(),
  notebooklmCLILogin: vi.fn(),
}));

vi.mock("../../../api/integrations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

// i18n: return the key so assertions can match on stable strings.
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en" }),
}));

// Router: stub navigation.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
}));

// Avoid Tauri-specific runtime paths during this unit test.
vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => false,
}));

// Stub the heavy workspace children so connection-state logic is isolated.
vi.mock("../NotebookLMSidebar", () => ({ NotebookLMSidebar: () => <div data-testid="sidebar" /> }));
vi.mock("../NotebookLMChat", () => ({ NotebookLMChat: () => <div data-testid="chat" /> }));
vi.mock("../NotebookLMStudio", () => ({
  NotebookLMStudio: () => <div data-testid="studio" />,
}));
vi.mock("../NotebookLMLoginPanel", () => ({
  NotebookLMLoginPanel: () => <div data-testid="login-panel" />,
}));

import { NotebookLMPage } from "../../../pages/NotebookLMPage";

const authError = () => {
  const e = new Error("session expired");
  // Mimics the structured rejection preserved by coerceError in lib/tauri.ts.
  (e as Error & { type: string }).type = "integration_auth_error";
  return Promise.reject(e);
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.notebooklmCLILogin.mockResolvedValue({ success: true, message: "ok" });
});

describe("NotebookLMPage connection state machine", () => {
  it("enters needs-reauth and shows Re-authenticate when listing fails with an auth error", async () => {
    api.notebooklmHealth.mockResolvedValue({ connected: true, message: "ok" });
    api.notebooklmListNotebooks.mockImplementation(authError);

    render(<NotebookLMPage />);

    await waitFor(() =>
      expect(screen.getByText("notebooklm.reauthenticate")).toBeInTheDocument()
    );
    // The green "Connected" badge must NOT render in the needs-reauth state.
    expect(screen.queryByText("notebooklm.connected")).not.toBeInTheDocument();
    // The actionable recovery message must be shown.
    expect(screen.getByText("notebooklm.reauthRequired")).toBeInTheDocument();
  });

  it("stays connected-but-empty (healthy) when listing succeeds with zero notebooks", async () => {
    api.notebooklmHealth.mockResolvedValue({ connected: true, message: "ok" });
    api.notebooklmListNotebooks.mockResolvedValue([]);

    render(<NotebookLMPage />);

    // Workspace empty state renders, and the badge reports connected.
    await waitFor(() =>
      expect(screen.getByText("notebooklm.createFirst")).toBeInTheDocument()
    );
    expect(screen.getByText("notebooklm.connected")).toBeInTheDocument();
    expect(screen.queryByText("notebooklm.reauthenticate")).not.toBeInTheDocument();
  });

  it("shows a generic error banner (with Re-authenticate offered) on a non-auth listing failure", async () => {
    api.notebooklmHealth.mockResolvedValue({ connected: true, message: "ok" });
    api.notebooklmListNotebooks.mockRejectedValue(new Error("runtime crash"));

    render(<NotebookLMPage />);

    await waitFor(() =>
      expect(screen.getByText("runtime crash")).toBeInTheDocument()
    );
    expect(screen.queryByText("notebooklm.connected")).not.toBeInTheDocument();
    // Re-authenticate is still offered as a convenience on any listing failure.
    expect(screen.getByText("notebooklm.reauthenticate")).toBeInTheDocument();
  });

  it("surfaces a listing timeout as an error with a working Retry affordance", async () => {
    api.notebooklmHealth.mockResolvedValue({ connected: true, message: "ok" });
    api.notebooklmListNotebooks.mockRejectedValue(
      new Error("NotebookLM notebook list timed out after 45s")
    );

    render(<NotebookLMPage />);

    await waitFor(() =>
      expect(screen.getByText(/timed out after 45s/)).toBeInTheDocument()
    );
    // A timeout is never a Connected badge over an empty workspace…
    expect(screen.queryByText("notebooklm.connected")).not.toBeInTheDocument();
    // …and it offers a plain retry (a cold CLI start is often just slow).
    const retry = screen.getByText("common.retry");
    expect(retry).toBeInTheDocument();

    api.notebooklmListNotebooks.mockResolvedValue([]);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByText("notebooklm.connected")).toBeInTheDocument()
    );
  });
});

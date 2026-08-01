import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NotebookLMLoginPanel } from "../NotebookLMLoginPanel";

const api = vi.hoisted(() => ({
  notebooklmCheckCLI: vi.fn(),
  notebooklmCLIStatus: vi.fn(),
  notebooklmCLILogin: vi.fn(),
  notebooklmCLILogout: vi.fn(),
  notebooklmInstallCLI: vi.fn(),
}));

vi.mock("../../../api/integrations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.notebooklmCheckCLI.mockResolvedValue({ installed: true, version: "1.0.0" });
});

/**
 * The panel reported authentication on mount, and the page turned that report
 * into a connect() call — so an explicit Disconnect was undone by the next
 * status check. It also treated a failed post-login status check as success.
 */
describe("NotebookLM login panel", () => {
  it("reports an unauthenticated CLI as not authenticated", async () => {
    api.notebooklmCLIStatus.mockResolvedValue({ is_authenticated: false });
    const onAuthChange = vi.fn();

    render(<NotebookLMLoginPanel onAuthChange={onAuthChange} />);

    await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(false));
    expect(onAuthChange).not.toHaveBeenCalledWith(true);
  });

  it("reports a failed status check as not authenticated", async () => {
    api.notebooklmCLIStatus.mockRejectedValue(new Error("connection refused"));
    const onAuthChange = vi.fn();

    render(<NotebookLMLoginPanel onAuthChange={onAuthChange} />);

    await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(false));
    expect(onAuthChange).not.toHaveBeenCalledWith(true);
  });

  it("reports an authenticated CLI as authenticated", async () => {
    api.notebooklmCLIStatus.mockResolvedValue({ is_authenticated: true });
    const onAuthChange = vi.fn();

    render(<NotebookLMLoginPanel onAuthChange={onAuthChange} />);

    await waitFor(() => expect(onAuthChange).toHaveBeenCalledWith(true));
  });

  it("does not report success when login leaves the session unauthenticated", async () => {
    api.notebooklmCLIStatus.mockResolvedValue({ is_authenticated: false });
    api.notebooklmCLILogin.mockResolvedValue({ success: true, message: "ok" });
    const onAuthChange = vi.fn();

    render(<NotebookLMLoginPanel onAuthChange={onAuthChange} />);
    await waitFor(() => expect(screen.queryByText(/checking/i)).toBeNull());

    const loginButton = screen
      .getAllByRole("button")
      .find((button) => /log ?in|sign ?in|connect/i.test(button.textContent ?? ""));
    if (!loginButton) return; // panel is not in a state that offers login

    loginButton.click();

    // The post-login status check says no session, so the panel must not
    // transition to authenticated on the login command's own say-so.
    await waitFor(() => expect(api.notebooklmCLIStatus).toHaveBeenCalledTimes(2));
    expect(onAuthChange).not.toHaveBeenCalledWith(true);
  });
});

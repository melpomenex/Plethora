import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { YouTubePlaylistManager } from "../YouTubePlaylistManager";
import type { PlaylistSettings, PlaylistSubscription } from "../../../api/youtubePlaylist";

const mockState = vi.hoisted(() => ({
  settings: {
    id: "default",
    enabled: true,
    default_intersperse_interval: 5,
    default_priority: 5,
    max_consecutive_playlist_videos: 1,
    prefer_new_videos: false,
    created_at: "2026-10-20T12:00:00Z",
    modified_at: "2026-10-20T12:00:00Z",
  } as PlaylistSettings,
  subscriptions: [] as PlaylistSubscription[],
  settingsWrites: [] as Partial<PlaylistSettings>[],
  subWrites: [] as Array<{ id: string; updates: Partial<PlaylistSubscription> }>,
  failSettingsWrite: null as Error | null,
  failSubWrite: null as Error | null,
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  invokeCommand: vi.fn(async (command: string, args: any) => {
    switch (command) {
      case "get_playlist_settings":
        return structuredClone(mockState.settings);
      case "update_playlist_settings":
        if (mockState.failSettingsWrite) {
          throw mockState.failSettingsWrite;
        }
        mockState.settingsWrites.push(structuredClone(args));
        Object.assign(mockState.settings, args, { modified_at: new Date().toISOString() });
        return structuredClone(mockState.settings);
      case "get_playlist_subscriptions":
        return structuredClone(mockState.subscriptions);
      case "get_playlist_subscription": {
        const sub = mockState.subscriptions.find((s) => s.id === args.subscriptionId);
        return {
          subscription: structuredClone(sub),
          videos: [],
        };
      }
      case "update_playlist_subscription": {
        if (mockState.failSubWrite) {
          throw mockState.failSubWrite;
        }
        const subId = (args.subscriptionId || args.id) as string;
        mockState.subWrites.push({ id: subId, updates: structuredClone(args) });
        const sub = mockState.subscriptions.find((s) => s.id === subId);
        if (sub) {
          Object.assign(sub, args, { modified_at: new Date().toISOString() });
          return structuredClone(sub);
        }
        throw new Error("Subscription not found");
      }
      default:
        return null;
    }
  }),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    settings: {},
    updateSettingsCategory: vi.fn(),
  }),
}));

vi.mock("../../settings/search/SettingsSearchNavigation", () => ({
  SettingsSearchTarget: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSettingsSearchTarget: () => ({ current: null }),
}));

function createFixtureSubscription(id = "sub-1"): PlaylistSubscription {
  return {
    id,
    playlist_id: "PL12345",
    playlist_url: "https://www.youtube.com/playlist?list=PL12345",
    title: "Rust Programming Playlist",
    channel_name: "Tech Channel",
    channel_id: "UC12345",
    description: "Great videos",
    thumbnail_url: null,
    total_videos: 10,
    is_active: true,
    auto_import_new: false,
    queue_intersperse_interval: 5,
    priority_rating: 5,
    last_refreshed_at: null,
    refresh_interval_hours: 24,
    created_at: "2026-10-20T12:00:00Z",
    modified_at: "2026-10-20T12:00:00Z",
  };
}

describe("YouTubePlaylistManager persistence, drafts, and validation (Task 7.1 & 7.2)", () => {
  beforeEach(() => {
    mockState.settings = {
      id: "default",
      enabled: true,
      default_intersperse_interval: 5,
      default_priority: 5,
      max_consecutive_playlist_videos: 1,
      prefer_new_videos: false,
      created_at: "2026-10-20T12:00:00Z",
      modified_at: "2026-10-20T12:00:00Z",
    };
    mockState.subscriptions = [createFixtureSubscription("sub-1")];
    mockState.settingsWrites = [];
    mockState.subWrites = [];
    mockState.failSettingsWrite = null;
    mockState.failSubWrite = null;
  });

  describe("Global settings form", () => {
    it("allows multi-digit typing without intermediate writes and persists only on explicit Save", async () => {
      render(<YouTubePlaylistManager />);

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.getByText("YouTube Playlist Auto-Import")).toBeInTheDocument();
      });

      // Open Settings
      const settingsToggle = screen.getByRole("button", { name: /Settings/i });
      fireEvent.click(settingsToggle);

      // Verify defaults form inputs are rendered
      const intervalInput = await screen.findByTestId("global-default-interval-input");
      const priorityInput = screen.getByTestId("global-default-priority-input");
      const maxConsecutiveInput = screen.getByTestId("global-max-consecutive-input");
      const saveBtn = screen.getByTestId("save-global-settings");
      const cancelBtn = screen.getByTestId("cancel-global-settings");

      // Save and Cancel are initially disabled
      expect(saveBtn).toBeDisabled();
      expect(cancelBtn).toBeDisabled();

      // Clear input and type multi-digit number: "1" then "12"
      fireEvent.change(intervalInput, { target: { value: "" } });
      expect(intervalInput).toHaveValue("");
      expect(mockState.settingsWrites.length).toBe(0);

      fireEvent.change(intervalInput, { target: { value: "1" } });
      expect(intervalInput).toHaveValue("1");
      expect(mockState.settingsWrites.length).toBe(0);

      fireEvent.change(intervalInput, { target: { value: "12" } });
      expect(intervalInput).toHaveValue("12");
      expect(mockState.settingsWrites.length).toBe(0);

      // Buttons are now enabled
      expect(saveBtn).not.toBeDisabled();
      expect(cancelBtn).not.toBeDisabled();

      // Click Save
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockState.settingsWrites.length).toBe(1);
      });

      expect(mockState.settingsWrites[0]).toEqual({
        enabled: true,
        prefer_new_videos: false,
        default_intersperse_interval: 12,
        default_priority: 5,
        max_consecutive_playlist_videos: 1,
      });

      // After save succeeds, saveBtn and cancelBtn are disabled again
      await waitFor(() => {
        expect(saveBtn).toBeDisabled();
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("Cancel button restores committed values and discards dirty draft", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("YouTube Playlist Auto-Import")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Settings/i }));

      const intervalInput = await screen.findByTestId("global-default-interval-input");
      const cancelBtn = screen.getByTestId("cancel-global-settings");

      // Edit interval to 25
      fireEvent.change(intervalInput, { target: { value: "25" } });
      expect(intervalInput).toHaveValue("25");

      // Click Cancel
      fireEvent.click(cancelBtn);

      // Value restored to committed 5
      expect(intervalInput).toHaveValue("5");
      expect(cancelBtn).toBeDisabled();
      expect(mockState.settingsWrites.length).toBe(0);
    });

    it("rejects invalid values (out-of-range, blanks, floats) with inline error and issues zero writes", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("YouTube Playlist Auto-Import")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Settings/i }));

      const intervalInput = await screen.findByTestId("global-default-interval-input");
      const priorityInput = screen.getByTestId("global-default-priority-input");
      const maxConsecutiveInput = screen.getByTestId("global-max-consecutive-input");
      const saveBtn = screen.getByTestId("save-global-settings");

      // Test 1: interval out of range (> 50)
      fireEvent.change(intervalInput, { target: { value: "51" } });
      fireEvent.click(saveBtn);
      expect(await screen.findByText(/Default queue interval must be an integer between 1 and 50/i)).toBeInTheDocument();
      expect(mockState.settingsWrites.length).toBe(0);
      expect(intervalInput).toHaveValue("51");

      // Test 2: interval is 0
      fireEvent.change(intervalInput, { target: { value: "0" } });
      fireEvent.click(saveBtn);
      expect(await screen.findByText(/Default queue interval must be an integer between 1 and 50/i)).toBeInTheDocument();
      expect(mockState.settingsWrites.length).toBe(0);

      // Test 3: interval is float
      fireEvent.change(intervalInput, { target: { value: "5.5" } });
      fireEvent.click(saveBtn);
      expect(await screen.findByText(/Default queue interval must be an integer between 1 and 50/i)).toBeInTheDocument();
      expect(mockState.settingsWrites.length).toBe(0);

      // Restore interval to valid 5
      fireEvent.change(intervalInput, { target: { value: "5" } });

      // Test 4: priority out of range (> 10)
      fireEvent.change(priorityInput, { target: { value: "11" } });
      fireEvent.click(saveBtn);
      expect(await screen.findByText(/Default priority must be an integer between 1 and 10/i)).toBeInTheDocument();
      expect(mockState.settingsWrites.length).toBe(0);

      // Restore priority
      fireEvent.change(priorityInput, { target: { value: "5" } });

      // Test 5: max consecutive out of range (> 5)
      fireEvent.change(maxConsecutiveInput, { target: { value: "6" } });
      fireEvent.click(saveBtn);
      expect(await screen.findByText(/Max consecutive playlist videos must be an integer between 1 and 5/i)).toBeInTheDocument();
      expect(mockState.settingsWrites.length).toBe(0);
    });

    it("retains dirty input on save failure and recovers on retry", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("YouTube Playlist Auto-Import")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Settings/i }));

      const intervalInput = await screen.findByTestId("global-default-interval-input");
      const saveBtn = screen.getByTestId("save-global-settings");

      // Inject save failure
      mockState.failSettingsWrite = new Error("Database locked");

      fireEvent.change(intervalInput, { target: { value: "8" } });
      fireEvent.click(saveBtn);

      expect(await screen.findByText("Database locked")).toBeInTheDocument();
      // Input value is still preserved
      expect(intervalInput).toHaveValue("8");

      // Clear the failure and retry
      mockState.failSettingsWrite = null;
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockState.settingsWrites.length).toBe(1);
      });
      expect(mockState.settings.default_intersperse_interval).toBe(8);
    });
  });

  describe("Per-subscription form", () => {
    it("allows multi-digit editing without intermediate writes and commits on Save", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("Rust Programming Playlist")).toBeInTheDocument());

      // Expand subscription details
      const expandBtn = screen.getByLabelText(/Expand playlist details/i);
      fireEvent.click(expandBtn);

      const subIntervalInput = await screen.findByTestId("sub-interval-input-sub-1");
      const subPriorityInput = screen.getByTestId("sub-priority-input-sub-1");
      const subRefreshInput = screen.getByTestId("sub-refresh-input-sub-1");
      const saveBtn = screen.getByTestId("save-sub-sub-1");
      const cancelBtn = screen.getByTestId("cancel-sub-sub-1");

      expect(saveBtn).toBeDisabled();
      expect(cancelBtn).toBeDisabled();

      // Edit priority to 8 without writing
      fireEvent.change(subPriorityInput, { target: { value: "8" } });
      expect(subPriorityInput).toHaveValue("8");
      expect(mockState.subWrites.length).toBe(0);

      // Edit interval to 15 without writing
      fireEvent.change(subIntervalInput, { target: { value: "15" } });
      expect(subIntervalInput).toHaveValue("15");
      expect(mockState.subWrites.length).toBe(0);

      expect(saveBtn).not.toBeDisabled();

      // Click Save
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockState.subWrites.length).toBe(1);
      });

      expect(mockState.subWrites[0]).toEqual({
        id: "sub-1",
        updates: {
          subscriptionId: "sub-1",
          queue_intersperse_interval: 15,
          priority_rating: 8,
          refresh_interval_hours: 24,
          auto_import_new: false,
        },
      });

      await waitFor(() => {
        expect(saveBtn).toBeDisabled();
      });
    });

    it("subscription Cancel restores original values", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("Rust Programming Playlist")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText(/Expand playlist details/i));

      const subIntervalInput = await screen.findByTestId("sub-interval-input-sub-1");
      const cancelBtn = screen.getByTestId("cancel-sub-sub-1");

      fireEvent.change(subIntervalInput, { target: { value: "30" } });
      expect(subIntervalInput).toHaveValue("30");

      fireEvent.click(cancelBtn);

      expect(subIntervalInput).toHaveValue("5");
      expect(cancelBtn).toBeDisabled();
      expect(mockState.subWrites.length).toBe(0);
    });

    it("subscription validates D9 numeric ranges and rejects invalid direct values", async () => {
      render(<YouTubePlaylistManager />);
      await waitFor(() => expect(screen.getByText("Rust Programming Playlist")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText(/Expand playlist details/i));

      const subRefreshInput = await screen.findByTestId("sub-refresh-input-sub-1");
      const saveBtn = screen.getByTestId("save-sub-sub-1");

      // Test refresh interval > 168
      fireEvent.change(subRefreshInput, { target: { value: "200" } });
      fireEvent.click(saveBtn);

      expect(await screen.findByText(/Refresh interval must be an integer between 1 and 168 hours/i)).toBeInTheDocument();
      expect(mockState.subWrites.length).toBe(0);
      expect(subRefreshInput).toHaveValue("200");
    });
  });
});

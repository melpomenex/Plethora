import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPWA: vi.fn(),
  queryAsyncCapabilities: vi.fn(),
  updateBadgeCount: vi.fn(),
  clearBadge: vi.fn(),
  settings: { settings: { notifications: { showBadge: true } } },
}));

vi.mock("../../tauri", () => ({ isPWA: mocks.isPWA }));
vi.mock("../capabilities", () => ({ queryAsyncCapabilities: mocks.queryAsyncCapabilities }));
vi.mock("../../../utils/notificationService", () => ({
  updateBadgeCount: mocks.updateBadgeCount,
  clearBadge: mocks.clearBadge,
}));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mocks.settings },
}));

import { updateDueBadgeCount } from "../badge";

describe("updateDueBadgeCount", () => {
  beforeEach(() => {
    mocks.isPWA.mockReturnValue(true);
    mocks.queryAsyncCapabilities.mockResolvedValue({ badgeAvailable: true });
    mocks.updateBadgeCount.mockClear();
    mocks.clearBadge.mockClear();
    mocks.settings.settings.notifications.showBadge = true;
  });

  it("sets a badge for due items on a supported installed PWA", async () => {
    await updateDueBadgeCount(12);

    expect(mocks.updateBadgeCount).toHaveBeenCalledWith(12);
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it("clears the badge when there are no due items or the preference is off", async () => {
    await updateDueBadgeCount(0);
    mocks.settings.settings.notifications.showBadge = false;
    await updateDueBadgeCount(4);

    expect(mocks.clearBadge).toHaveBeenCalledTimes(2);
    expect(mocks.updateBadgeCount).not.toHaveBeenCalled();
  });

  it("does nothing outside an installed PWA or without the Badging API", async () => {
    mocks.isPWA.mockReturnValue(false);
    await updateDueBadgeCount(4);
    mocks.isPWA.mockReturnValue(true);
    mocks.queryAsyncCapabilities.mockResolvedValue({ badgeAvailable: false });
    await updateDueBadgeCount(4);

    expect(mocks.updateBadgeCount).not.toHaveBeenCalled();
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });
});


import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkNotificationPermission,
  areNotificationsSupported,
  isPeriodicSyncSupported,
  supportsHaptics,
} = vi.hoisted(() => ({
  checkNotificationPermission: vi.fn(),
  areNotificationsSupported: vi.fn(),
  isPeriodicSyncSupported: vi.fn(),
  supportsHaptics: vi.fn(),
}));

vi.mock("../../../utils/notificationService", () => ({
  areNotificationsSupported,
  checkNotificationPermission,
}));
vi.mock("../../../utils/pushSubscription", () => ({ isPeriodicSyncSupported }));
vi.mock("../../../utils/soundService", () => ({ supportsHaptics }));

import { queryAsyncCapabilities } from "../capabilities";

describe("queryAsyncCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    areNotificationsSupported.mockReturnValue(true);
    checkNotificationPermission.mockResolvedValue("granted");
    isPeriodicSyncSupported.mockReturnValue(true);
    supportsHaptics.mockReturnValue(true);
    delete (navigator as Navigator & { setAppBadge?: unknown }).setAppBadge;
  });

  it("reports the supported capabilities without changing their values", async () => {
    Object.defineProperty(navigator, "setAppBadge", {
      configurable: true,
      value: vi.fn(),
    });

    await expect(queryAsyncCapabilities()).resolves.toEqual({
      notificationPermission: "granted",
      periodicSyncAvailable: true,
      badgeAvailable: true,
      hapticsAvailable: true,
    });
    expect(checkNotificationPermission).toHaveBeenCalledOnce();
    expect(isPeriodicSyncSupported).toHaveBeenCalledOnce();
    expect(supportsHaptics).toHaveBeenCalledOnce();
  });

  it("reports unsupported notification APIs and false optional capabilities", async () => {
    areNotificationsSupported.mockReturnValue(false);
    isPeriodicSyncSupported.mockReturnValue(false);
    supportsHaptics.mockReturnValue(false);

    await expect(queryAsyncCapabilities()).resolves.toEqual({
      notificationPermission: "unsupported",
      periodicSyncAvailable: false,
      badgeAvailable: false,
      hapticsAvailable: false,
    });
    expect(checkNotificationPermission).not.toHaveBeenCalled();
  });

  it("never throws when a capability helper fails", async () => {
    checkNotificationPermission.mockRejectedValue(new Error("permission unavailable"));
    isPeriodicSyncSupported.mockImplementation(() => {
      throw new Error("periodic sync unavailable");
    });
    supportsHaptics.mockImplementation(() => {
      throw new Error("haptics unavailable");
    });

    await expect(queryAsyncCapabilities()).resolves.toEqual({
      notificationPermission: "unsupported",
      periodicSyncAvailable: false,
      badgeAvailable: false,
      hapticsAvailable: false,
    });
  });
});

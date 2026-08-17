/**
 * Tests for the update-notification "seen/skip version" persistence.
 *
 * The product rule is "show each version once, then never again": the moment
 * a version is surfaced to the user we call `setSkippedVersion(version)`, and
 * `checkForUpdates(false)` suppresses any version equal to the stored one.
 *
 * The first block pins the storage contract; the second block is an
 * end-to-end check that simulates two real boots through the actual
 * `checkForUpdates` entry point (Tauri updater mocked), proving the nag does
 * NOT reappear on the second boot. This is the class of test that would have
 * caught the onboarding-tour regression (tests passed in isolation but the
 * real app re-showed the tour because of a between-boots state clobber).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the Tauri environment helpers so the desktop (Tauri) branch runs.
vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  nativePlatform: () => null,
}));

// Hoist the mock implementations so the factories can reference them.
const { checkMock, invokeMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  invokeMock: vi.fn(),
}));

// Mock the Tauri updater plugin's `check`. Each test configures the return.
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}));

// Mock the Tauri core `invoke` so tests can stub the `updater_bundle_type`
// command (deb/rpm installs must get the manual download path). Defaults to
// "appimage" (in-place-capable) in beforeEach.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {},
}));

import {
  checkForUpdates,
  getSkippedVersion,
  normalizeVersion,
  setSkippedVersion,
} from "../updateChecker";

const SKIP_KEY = "plethora_skip_update_version";

/** Build a fake Tauri `Update` object for a given version. */
function fakeUpdate(version: string) {
  return {
    version,
    body: `Release notes for ${version}`,
    date: "2026-01-01T00:00:00Z",
    downloadAndInstall: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  checkMock.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue("appimage");
});

describe("updateChecker skip/seen persistence (storage contract)", () => {
  test("getSkippedVersion is null before any version is seen", () => {
    expect(getSkippedVersion()).toBeNull();
  });

  test("setSkippedVersion round-trips the version string, normalized to bare semver", () => {
    setSkippedVersion("2.1.0");
    expect(getSkippedVersion()).toBe("2.1.0");
    expect(window.localStorage.getItem(SKIP_KEY)).toBe("2.1.0");
  });

  test("setSkippedVersion strips a leading v (GitHub tag_name form)", () => {
    setSkippedVersion("v2.2.0");
    expect(getSkippedVersion()).toBe("2.2.0");
    expect(window.localStorage.getItem(SKIP_KEY)).toBe("2.2.0");
  });

  test("normalizeVersion strips a leading v and leaves bare semver untouched", () => {
    expect(normalizeVersion("v2.1.0")).toBe("2.1.0");
    expect(normalizeVersion("2.1.0")).toBe("2.1.0");
  });

  test("a newer version overwrites the previously-seen version (one stored slot)", () => {
    setSkippedVersion("2.1.0");
    setSkippedVersion("2.2.0");
    expect(getSkippedVersion()).toBe("2.2.0");
  });

  test("the equality gate suppresses only the exact seen version (normalized)", () => {
    setSkippedVersion("2.1.0");
    // Mirrors the real gate: getSkippedVersion() === normalizeVersion(candidate)
    const suppresses = (candidate: string) =>
      getSkippedVersion() === normalizeVersion(candidate);
    expect(suppresses("2.1.0")).toBe(true); // same → suppressed
    expect(suppresses("v2.1.0")).toBe(true); // v-prefixed → still suppressed
    expect(suppresses("2.2.0")).toBe(false); // newer → notifies once
    expect(suppresses("2.0.0")).toBe(false); // older → not suppressed
  });
});

describe("checkForUpdates — once-per-version across two boots", () => {
  test("boot 1 surfaces the update; boot 2 suppresses the SAME version (no re-nag)", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.2.0"));

    // --- Boot 1: no version seen yet. checkForUpdates(false) returns the update. ---
    const boot1 = await checkForUpdates(false);
    expect(boot1).not.toBeNull();
    expect(boot1!.latestVersion).toBe("2.2.0");

    // MainLayout marks it seen the moment it surfaces the toast.
    setSkippedVersion(boot1!.latestVersion);
    expect(getSkippedVersion()).toBe("2.2.0");

    // --- Boot 2: same version still in the manifest. Must be suppressed. ---
    const boot2 = await checkForUpdates(false);
    expect(boot2).toBeNull(); // no re-nag — the whole point
  });

  test("a genuinely newer version on a later boot notifies once again", async () => {
    // Boot 1: saw 2.2.0.
    checkMock.mockResolvedValue(fakeUpdate("2.2.0"));
    const boot1 = await checkForUpdates(false);
    setSkippedVersion(boot1!.latestVersion);

    // Later boot: manifest now advertises 2.3.0.
    checkMock.mockResolvedValue(fakeUpdate("2.3.0"));
    const boot2 = await checkForUpdates(false);
    expect(boot2).not.toBeNull();
    expect(boot2!.latestVersion).toBe("2.3.0");
  });

  test("force=true (manual Settings check) surfaces the update even when already seen", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.2.0"));
    setSkippedVersion("2.2.0"); // already seen

    const forced = await checkForUpdates(true);
    expect(forced).not.toBeNull(); // manual check always works
    expect(forced!.latestVersion).toBe("2.2.0");
  });

  test("up-to-date (Tauri check returns null) is never surfaced", async () => {
    checkMock.mockResolvedValue(null);
    expect(await checkForUpdates(false)).toBeNull();
  });

  test("cross-source mismatch: seen via v-prefixed (GitHub) form, suppressed on a bare (Tauri) boot", async () => {
    // Boot 1: the GitHub fallback path returned the tag_name "v2.2.0".
    // Simulate MainLayout marking it seen from that source.
    setSkippedVersion("v2.2.0");
    expect(getSkippedVersion()).toBe("2.2.0"); // stored normalized

    // Boot 2: the Tauri manifest path returns bare "2.2.0". Before the
    // normalize fix this mismatch (v2.2.0 !== 2.2.0) would have re-nagged.
    // It must now be suppressed.
    checkMock.mockResolvedValue(fakeUpdate("2.2.0"));
    const boot2 = await checkForUpdates(false);
    expect(boot2).toBeNull();
  });

  test("cross-source mismatch: seen via bare (Tauri) form, suppressed on a v-prefixed (GitHub) boot", async () => {
    setSkippedVersion("2.2.0"); // Tauri manifest form

    // A boot that falls back to GitHub sees tag_name "v2.2.0".
    checkMock.mockResolvedValue(fakeUpdate("v2.2.0"));
    const boot2 = await checkForUpdates(false);
    expect(boot2).toBeNull();
  });
});

describe("checkForUpdates — Linux system-package installs (deb/rpm)", () => {
  // The Tauri updater replaces the running executable; for deb/rpm installs
  // that's a root-owned /usr/bin binary, so the in-place path can never
  // succeed. These installs must get the manual-download offer instead.

  test("deb install: no in-place handle, manualOnlyReason=deb, release-page link", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.7.0"));
    invokeMock.mockResolvedValue("deb");

    const info = await checkForUpdates(false);
    expect(info).not.toBeNull();
    expect(info!.latestVersion).toBe("2.7.0");
    expect(info!.updater).toBeNull();
    expect(info!.manualOnlyReason).toBe("deb");
    expect(info!.downloadUrl).toContain("releases/tag/v2.7.0");
  });

  test("rpm install gets the manual path too", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.7.0"));
    invokeMock.mockResolvedValue("rpm");

    const info = await checkForUpdates(false);
    expect(info!.updater).toBeNull();
    expect(info!.manualOnlyReason).toBe("rpm");
  });

  test("AppImage install keeps the in-place handle with no manual reason", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.7.0"));
    invokeMock.mockResolvedValue("appimage");

    const info = await checkForUpdates(false);
    expect(info!.updater).not.toBeNull();
    expect(info!.manualOnlyReason).toBeFalsy();
  });

  test("bundle-type probe failure defaults to the in-place path (dev/unknown bundles)", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.7.0"));
    invokeMock.mockRejectedValue(new Error("command unavailable"));

    const info = await checkForUpdates(false);
    expect(info!.updater).not.toBeNull();
  });

  test("skip-list still suppresses a seen version on deb installs", async () => {
    checkMock.mockResolvedValue(fakeUpdate("2.7.0"));
    invokeMock.mockResolvedValue("deb");
    setSkippedVersion("2.7.0");

    expect(await checkForUpdates(false)).toBeNull();
  });
});

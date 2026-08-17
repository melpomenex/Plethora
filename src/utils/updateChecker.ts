/**
 * Update checker utility for incrementum-tauri
 *
 * Two paths:
 * - Desktop (Tauri): uses `@tauri-apps/plugin-updater`, which fetches a signed
 *   `latest.json` manifest and verifies the bundle signature. The returned
 *   `Update` object can be passed to `installUpdate()` for an in-place update.
 * - Browser / PWA: falls back to the GitHub Releases API and reports the
 *   release URL (the user downloads the installer manually).
 */

import { isTauri, isNativeMobile, nativePlatform } from "../lib/tauri";

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/melpomenex/incrementum-tauri/releases/latest";
const SKIP_VERSION_KEY = "plethora_skip_update_version";

// Re-export the updater's Update type lazily via a structural alias so callers
// in UpdateAvailableDialog can call `.downloadAndInstall()` without a hard
// import in this module's public surface.
export type UpdaterHandle = {
  /** Progress callback: receives 0–1 fraction and total downloaded/content-length bytes. */
  downloadAndInstall(
    onProgress?: (fraction: number) => void
  ): Promise<void>;
};

export interface UpdateInfo {
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  releaseDate: string;
  /**
   * Desktop-only: an opaque handle whose `downloadAndInstall()` performs the
   * signed in-place update. `null` in the browser/PWA path (manual download).
   */
  updater: UpdaterHandle | null;
  /**
   * Set when the running install cannot accept an in-place update ("deb" /
   * "rpm" on Linux — the Tauri updater replaces the running executable,
   * which for system packages is a root-owned /usr/bin binary). The dialog
   * should offer the release download instead of a doomed install attempt.
   */
  manualOnlyReason?: "deb" | "rpm" | null;
}

/**
 * Simple semver compare. Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Parse a version string into up to three numeric components, tolerating a
 * leading `v` (GitHub `tag_name` uses `v2.1.0`; the Tauri manifest `version`
 * field is bare `2.1.0`). Non-numeric segments fall back to 0.
 */
function parseSemver(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/**
 * Normalize a version string to bare semver (no leading `v`). The skip/seen
 * flag stores and compares through this so a fallback from the Tauri manifest
 * (bare `2.1.0`) to the GitHub Releases API (`tag_name` = `v2.1.0`) can't
 * break the equality gate and re-nag a version the user has already seen.
 */
export function normalizeVersion(version: string): string {
  return version.replace(/^v/, "");
}

/**
 * Get the current app version.
 * Uses the Tauri API when available, otherwise returns null.
 */
export async function getCurrentVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}

/**
 * Get the version the user has chosen to skip.
 */
export function getSkippedVersion(): string | null {
  return localStorage.getItem(SKIP_VERSION_KEY);
}

/**
 * Save a version to the skip list so we don't nag about it. Stored normalized
 * to bare semver so the source (Tauri manifest vs. GitHub tag) doesn't matter.
 */
export function setSkippedVersion(version: string): void {
  localStorage.setItem(SKIP_VERSION_KEY, normalizeVersion(version));
}

/**
 * Relaunch the app after an in-place update. Desktop-only; no-op otherwise.
 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.warn("[updateChecker] relaunch failed:", err);
  }
}

/**
 * The bundle type the running binary was packaged in ("appimage", "deb",
 * "rpm", "app", "nsis", "msi") or "unknown" for unbundled dev runs, as
 * patched in at build time by tauri-bundler.
 */
async function getUpdaterBundleType(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("updater_bundle_type");
  } catch {
    return "unknown";
  }
}

/**
 * Release page for a version — the manual-download fallback target (the
 * Tauri `Update` object does not expose the bundle URL to JS).
 */
function releaseTagUrl(latestVersion: string): string {
  return `https://github.com/melpomenex/incrementum-tauri/releases/tag/v${latestVersion.replace(/^v/, "")}`;
}

/**
 * Desktop path: consult the Tauri updater plugin. Returns an `UpdateInfo`
 * whose `updater` field can perform a signed in-place install, or `null`
 * when up-to-date / unavailable.
 */
async function checkViaTauriUpdater(
  force: boolean
): Promise<UpdateInfo | null> {
  const { check } = await import("@tauri-apps/plugin-updater");

  // `check()` already compares versions against the running app and returns
  // `null` when current. It reads the endpoint + pubkey from tauri.conf.json.
  const update = await check();
  if (!update) return null;

  const latestVersion = update.version;

  // Respect the skip list (unless forced) even though the updater found one.
  // Compare normalized (bare semver) so a Tauri→GitHub fallback can't bypass
  // a version the user already saw.
  if (!force && getSkippedVersion() === normalizeVersion(latestVersion)) {
    return null;
  }

  // Linux system-package installs (deb/rpm) cannot accept an in-place
  // update: the updater replaces the running executable, which for these
  // packages is a root-owned /usr/bin binary. Offer the release download
  // instead of an install that would always fail with a permission error.
  const bundleType = await getUpdaterBundleType();
  if (bundleType === "deb" || bundleType === "rpm") {
    return {
      latestVersion,
      releaseNotes: update.body ?? "",
      downloadUrl: releaseTagUrl(latestVersion),
      releaseDate: update.date ?? "",
      updater: null,
      manualOnlyReason: bundleType,
    };
  }

  return {
    latestVersion,
    releaseNotes: update.body ?? "",
    // Tauri's Update object does not expose the bundle URL to JS; the manifest
    // lives on the release page, which we link as the manual-download fallback.
    downloadUrl: releaseTagUrl(latestVersion),
    releaseDate: update.date ?? "",
    updater: {
      downloadAndInstall: async (onProgress?: (fraction: number) => void) => {
        let total = 0;
        let downloaded = 0;
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              total = event.data.contentLength ?? 0;
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              if (onProgress && total > 0) {
                onProgress(downloaded / total);
              }
              break;
            case "Finished":
              if (onProgress) onProgress(1);
              break;
          }
        });
        await update.close();
      },
    },
  };
}

/**
 * Browser/PWA path: query the GitHub Releases API.
 */
async function checkViaGitHub(
  force: boolean
): Promise<UpdateInfo | null> {
  const currentVersion = await getCurrentVersion();

  const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!res.ok) {
    console.warn(
      `[updateChecker] GitHub API returned ${res.status}: ${res.statusText}`
    );
    return null;
  }

  const data = await res.json();
  const latestVersion: string = data.tag_name ?? data.name ?? "";
  const body: string = data.body ?? "";
  const htmlUrl: string = data.html_url ?? "";
  const publishedAt: string = data.published_at ?? "";

  if (!latestVersion || !currentVersion) return null;

  if (semverCompare(latestVersion, currentVersion) <= 0) {
    return null; // up-to-date
  }

  if (!force && getSkippedVersion() === normalizeVersion(latestVersion)) {
    return null;
  }

  // Construct a custom in-app updater for Android if an APK asset is available
  let updater: UpdaterHandle | null = null;
  const isAndroid = isTauri() && nativePlatform() === "android";
  
  if (isAndroid && Array.isArray(data.assets)) {
    const apkAsset = data.assets.find(
      (asset: any) =>
        asset.name?.endsWith(".apk") ||
        asset.content_type === "application/vnd.android.package-archive"
    );
    const apkUrl = apkAsset?.browser_download_url;

    if (apkUrl) {
      updater = {
        downloadAndInstall: async (onProgress?: (fraction: number) => void) => {
          const { Channel, invoke } = await import("@tauri-apps/api/core");
          const channel = new Channel<number>();
          channel.onmessage = (progress) => {
            if (onProgress) {
              onProgress(progress);
            }
          };

          // 1. Download the APK file via Rust command
          const filePath = await invoke<string>("download_update_apk", {
            url: apkUrl,
            onProgress: channel,
          });

          // 1b. Automatically backup database to Downloads folder on Android before installing
          const { invokeCommand } = await import("../lib/tauri");
          try {
            console.log("[updateChecker] Backing up database to Downloads before installation...");
            const backupPath = await invokeCommand<string>("plugin:plethora-folder-import|backup_db_to_downloads");
            console.log("[updateChecker] Auto-backup completed to:", backupPath);
          } catch (err) {
            console.warn("[updateChecker] Auto-backup database failed:", err);
          }

          // 2. Install the APK file via our custom Android plugin command
          await invokeCommand("plugin:plethora-folder-import|install_apk", {
            filePath,
          });
        },
      };
    }
  }

  return {
    latestVersion,
    releaseNotes: body,
    downloadUrl: htmlUrl,
    releaseDate: publishedAt,
    updater,
  };
}

/**
 * Check for updates.
 *
 * - On desktop (Tauri): uses the signed-manifest updater and returns an
 *   installable handle.
 * - On browser/PWA: falls back to the GitHub Releases API (manual download).
 *
 * Returns `UpdateInfo` when a newer version is available, or `null` when
 * up-to-date, skipped, or the check fails.
 *
 * @param force  If true, ignores the skip-version preference.
 */
export async function checkForUpdates(
  force = false
): Promise<UpdateInfo | null> {
  try {
    if (isTauri() && !isNativeMobile()) {
      return await checkViaTauriUpdater(force);
    }
    return await checkViaGitHub(force);
  } catch (err) {
    console.warn("[updateChecker] Failed to check for updates:", err);
    // Last-resort fallback: if the desktop updater throws (e.g. offline /
    // manifest fetch failure), try the GitHub API so the user still sees
    // something useful.
    try {
      return await checkViaGitHub(force);
    } catch {
      return null;
    }
  }
}

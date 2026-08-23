import type { CpuArch, PlatformId } from './platforms.ts';
import { PLATFORM_IDS } from './platforms.ts';

export type DownloadAvailability =
  | { status: 'live'; href: string; arch?: CpuArch[]; store?: 'direct' }
  | { status: 'store'; href: string; store: 'app-store' | 'play-store' | 'microsoft-store' }
  | { status: 'coming-soon'; message: string }
  | { status: 'disabled'; message: string };

export interface DownloadManifest {
  version?: string;
  updatedAt?: string;
  platforms: Record<PlatformId, DownloadAvailability>;
  systemRequirements: Record<PlatformId, string[]>;
}

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
};

export const DOWNLOADS: DownloadManifest = {
  platforms: {
    windows: {
      status: 'coming-soon',
      message:
        'Windows installers (x64 and arm64) will appear here. Direct download is not published yet.',
    },
    macos: {
      status: 'coming-soon',
      message:
        'macOS builds will appear here. Notarized store or direct URLs are not published yet; current desktop builds may still be self-signed.',
    },
    linux: {
      status: 'coming-soon',
      message:
        '.deb, AppImage, and architecture notes will appear here when Linux packages are published. No package URL is live.',
    },
    ios: {
      status: 'coming-soon',
      message: 'iOS is not listed on a public store yet. No App Store URL is available.',
    },
    android: {
      status: 'coming-soon',
      message:
        'A public Play listing and sideload APK URL are not published yet. No store href is live.',
    },
  },
  systemRequirements: {
    windows: [
      'Windows 10 or later (x64 or arm64) once installers ship.',
      'Architecture-specific builds will be labeled when URLs exist.',
    ],
    macos: [
      'A recent macOS version on Apple silicon or Intel once builds ship.',
      'Signing and notarization caveats will be listed with the first public file.',
    ],
    linux: [
      'x64 and arm64 notes, plus .deb / AppImage, once packages ship.',
      'Distro support will be published with the binaries — not guessed here.',
    ],
    ios: [
      'Requirements will follow the store listing when it exists.',
      'No TestFlight or App Store link is offered on this page yet.',
    ],
    android: [
      'Requirements will follow the Play listing or APK notes when published.',
      'Play Billing is not live; this page does not offer a store or APK href.',
    ],
  },
};

export function downloadControl(platform: PlatformId): {
  platform: PlatformId;
  label: string;
  availability: DownloadAvailability;
  liveHref: string | null;
} {
  const availability = DOWNLOADS.platforms[platform];
  const liveHref =
    availability.status === 'live' || availability.status === 'store' ? availability.href : null;
  return {
    platform,
    label: PLATFORM_LABELS[platform],
    availability,
    liveHref,
  };
}

export function allDownloadControls() {
  return PLATFORM_IDS.map((platform) => downloadControl(platform));
}

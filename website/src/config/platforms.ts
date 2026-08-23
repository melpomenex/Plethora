/**
 * Shared website contracts. Downstream changes B–F MUST import these modules
 * instead of declaring parallel flag, plan, claim, or demo types.
 *
 * Normative source: openspec/planning/useplethora-website-shared-contracts.md
 */

export type DesktopOs = 'windows' | 'macos' | 'linux';
export type MobileOs = 'ios' | 'android';
export type PlatformId = DesktopOs | MobileOs;
export type CpuArch = 'x64' | 'arm64' | 'universal';

export const PLATFORM_IDS: PlatformId[] = ['windows', 'macos', 'linux', 'ios', 'android'];

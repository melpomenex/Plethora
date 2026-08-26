/**
 * Compile-time build fingerprint for engineer diagnostics.
 */

import { BUILD_PROFILE, type BuildProfile } from "./buildProfile";
import { RUNTIME_TARGET, type FrontendRuntimeTarget } from "./runtimeTarget";

declare const __PLETHORA_APP_VERSION__: string | undefined;
declare const __PLETHORA_GIT_SHA__: string | undefined;
declare const __PLETHORA_BUILD_ID__: string | undefined;

export interface BuildFingerprint {
  version: string;
  gitSha: string;
  buildId: string;
  runtimeTarget: FrontendRuntimeTarget;
  buildProfile: BuildProfile;
}

export function getBuildFingerprint(): BuildFingerprint {
  return {
    version: typeof __PLETHORA_APP_VERSION__ !== "undefined" ? __PLETHORA_APP_VERSION__ : "unknown",
    gitSha: typeof __PLETHORA_GIT_SHA__ !== "undefined" ? __PLETHORA_GIT_SHA__ : "unknown",
    buildId: typeof __PLETHORA_BUILD_ID__ !== "undefined" ? __PLETHORA_BUILD_ID__ : "unknown",
    runtimeTarget: RUNTIME_TARGET,
    buildProfile: BUILD_PROFILE,
  };
}

/** Logged once at startup when diagnostics are enabled. */
export function logBuildFingerprint(): void {
  const fp = getBuildFingerprint();
  console.info(
    `[Plethora build] target=${fp.runtimeTarget} profile=${fp.buildProfile} ` +
      `version=${fp.version} sha=${fp.gitSha} buildId=${fp.buildId}`
  );
}

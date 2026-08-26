/**
 * Frontend runtime target — single source of truth for Vite build classification.
 *
 * Distinct from `BuildProfile` (development | sideload | store), which describes
 * distribution policy. A Tauri store build is `target=tauri, profile=store`.
 */

export type FrontendRuntimeTarget = "tauri" | "pwa" | "web";

/** Environment variables consulted for Tauri detection (Node + tests). */
export interface RuntimeTargetEnv {
  PLETHORA_TAURI?: string;
  INCREMENTUM_TAURI?: string;
  PLETHORA_RUNTIME_TARGET?: string;
  TAURI_DEV_HOST?: string;
  TAURI_PLATFORM?: string;
  TAURI_ARCH?: string;
  TAURI_FAMILY?: string;
  TAURI_ENV_PLATFORM?: string;
  TAURI_ENV_ARCH?: string;
  TAURI_ENV_FAMILY?: string;
  TAURI_ENV_TARGET_TRIPLE?: string;
  TAURI_ENV_DEBUG?: string;
}

const VALID_TARGETS: readonly FrontendRuntimeTarget[] = ["tauri", "pwa", "web"];

function truthy(value: string | undefined): boolean {
  return Boolean(value && value !== "0" && value.toLowerCase() !== "false");
}

/** True when any Tauri 1/2 hook environment signal is present. */
export function isTauriEnvironment(env: RuntimeTargetEnv): boolean {
  return (
    truthy(env.PLETHORA_TAURI) ||
    truthy(env.INCREMENTUM_TAURI) ||
    Boolean(env.TAURI_DEV_HOST) ||
    Boolean(env.TAURI_PLATFORM) ||
    Boolean(env.TAURI_ARCH) ||
    Boolean(env.TAURI_FAMILY) ||
    Boolean(env.TAURI_ENV_PLATFORM) ||
    Boolean(env.TAURI_ENV_ARCH) ||
    Boolean(env.TAURI_ENV_FAMILY) ||
    Boolean(env.TAURI_ENV_TARGET_TRIPLE)
  );
}

function parseExplicitTarget(value: string | undefined): FrontendRuntimeTarget | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  if ((VALID_TARGETS as readonly string[]).includes(normalized)) {
    return normalized as FrontendRuntimeTarget;
  }
  throw new Error(
    `Invalid PLETHORA_RUNTIME_TARGET "${value}". Expected one of: ${VALID_TARGETS.join(", ")}.`
  );
}

export interface ResolvedViteBuildTargets {
  runtimeTarget: FrontendRuntimeTarget;
  isTauriBuild: boolean;
  isPWA: boolean;
  isProd: boolean;
}

/**
 * Resolve Vite build flags from environment + mode.
 *
 * Repository policy (preserved):
 * - `npm run build` without Tauri env → PWA production bundle
 * - `npm run build:pwa` → PWA
 * - `tauri build` / Tauri env → Tauri (never PWA)
 * - `npm run dev` → web
 */
export function resolveViteBuildTargets(
  env: RuntimeTargetEnv,
  viteMode: string
): ResolvedViteBuildTargets {
  const isProd = viteMode === "production" || viteMode === "pwa";
  const tauri = isTauriEnvironment(env);
  const explicit = parseExplicitTarget(env.PLETHORA_RUNTIME_TARGET);

  if (viteMode === "pwa" && tauri && explicit !== "pwa") {
    throw new Error(
      "Invalid build target: Tauri environment cannot compile with explicit PWA Vite mode."
    );
  }

  let runtimeTarget: FrontendRuntimeTarget;
  if (explicit) {
    if (tauri && explicit !== "tauri") {
      throw new Error(
        `Invalid build target: Tauri environment cannot use PLETHORA_RUNTIME_TARGET=${explicit}.`
      );
    }
    runtimeTarget = explicit;
  } else if (tauri) {
    runtimeTarget = "tauri";
  } else if (viteMode === "pwa" || isProd) {
    runtimeTarget = "pwa";
  } else {
    runtimeTarget = "web";
  }

  if (tauri && runtimeTarget === "pwa") {
    throw new Error(
      "Invalid build target: Tauri environment classified as PWA. " +
        "Check TAURI_ENV_* / PLETHORA_TAURI detection."
    );
  }

  const isTauriBuild = runtimeTarget === "tauri";
  const isPWA = runtimeTarget === "pwa";

  return { runtimeTarget, isTauriBuild, isPWA, isProd };
}

declare const __PLETHORA_RUNTIME_TARGET__: string | undefined;

export const RUNTIME_TARGET: FrontendRuntimeTarget = (() => {
  if (typeof __PLETHORA_RUNTIME_TARGET__ === "undefined") return "web";
  const parsed = parseExplicitTarget(__PLETHORA_RUNTIME_TARGET__);
  return parsed ?? "web";
})();

export function isTauriRuntimeTarget(): boolean {
  return RUNTIME_TARGET === "tauri";
}

export function isPwaRuntimeTarget(): boolean {
  return RUNTIME_TARGET === "pwa";
}

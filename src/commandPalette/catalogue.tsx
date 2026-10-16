/**
 * Compatibility re-exports for the unified command registry.
 *
 * The catalogue's assembly logic now lives in `src/commandPalette/registry.tsx`
 * (one authoritative registry). This module keeps the old import surface
 * (`buildCommandCatalogue`, `navigateTo`, `commandMatchesQuery`) working for
 * existing consumers; new code should import from `./registry` directly.
 */

export {
  buildCommandRegistry as buildCommandCatalogue,
  matchCommands,
  commandMatchesQuery,
  navigateTo,
} from "./registry";

export type { RegistryDeps as CatalogueDeps, CommandMatch, CommandMatchTier } from "./registry";

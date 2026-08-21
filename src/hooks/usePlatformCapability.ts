import { useMemo } from "react";
import {
  getPlatformCapability,
  type PlatformAvailability,
  type PlatformCapabilityId,
} from "../lib/platformCapabilities";

/**
 * Hook to inspect the platform availability of a specific surface.
 * Mirrors `useCapability` (entitlements) on the platform axis. Platform
 * detection is synchronous and immutable for the app's lifetime, so a
 * memoized read is sufficient (no reactive re-resolution needed).
 */
export function usePlatformCapability(
  id: PlatformCapabilityId
): PlatformAvailability {
  return useMemo(() => getPlatformCapability(id), [id]);
}

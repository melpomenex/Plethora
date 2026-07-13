export interface RelayLimits {
  maxConcurrentProviders: number;
  multiplexed: boolean;
}

/** Conservative fallback until the deployed relay advertises multiplexing. */
export function getRelayLimits(capabilities: string[] = []): RelayLimits {
  return capabilities.includes("multiplexed-shards")
    ? { maxConcurrentProviders: 1, multiplexed: true }
    : { maxConcurrentProviders: 4, multiplexed: false };
}

/**
 * Release rollback switches. These gate presentation only; native/browser
 * command contracts remain backward compatible while a flag is disabled.
 */
export const featureFlags = {
  reviewAlgorithmArena:
    String(import.meta.env.VITE_REVIEW_ALGORITHM_ARENA ?? "true").toLowerCase() !== "false",
} as const;

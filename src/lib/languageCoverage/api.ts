import type {
  CoverageCalculationResult,
  CoverageDetail,
  CoverageProjection,
  CoverageSummary,
} from "./types";

/** Pure adapters keep pending/stale coverage distinct from a measured zero. */
export function coverageSummary(
  projection: CoverageProjection | CoverageCalculationResult,
): CoverageSummary | undefined {
  if ("summary" in projection && projection.summary?.freshness === "fresh") return projection.summary;
  return undefined;
}

export function coverageDetail(
  projection: CoverageProjection | CoverageCalculationResult,
  calculation?: CoverageCalculationResult,
): CoverageDetail {
  if ("chunks" in projection && "summary" in projection) {
    return {
      freshness: projection.summary.freshness,
      version: projection.version,
      summary: projection.summary,
      chunks: projection.chunks,
      units: projection.chunks.flatMap((chunk) => chunk.units),
    };
  }
  return {
    freshness: projection.freshness,
    version: projection.version,
    summary: projection.summary,
    chunks: calculation?.chunks ?? [],
    units: calculation?.chunks.flatMap((chunk) => chunk.units) ?? [],
    error: projection.error,
  };
}

export function coverageDisplayState(projection: CoverageProjection): {
  freshness: CoverageProjection["freshness"];
  coveragePercent?: number;
  difficultyLabel?: string;
  message: string;
} {
  if (!projection.summary || projection.freshness !== "fresh") {
    return { freshness: projection.freshness, message: projection.freshness };
  }
  return {
    freshness: "fresh",
    coveragePercent: projection.summary.coveragePercent,
    difficultyLabel: projection.summary.difficultyLabel,
    message: "fresh",
  };
}

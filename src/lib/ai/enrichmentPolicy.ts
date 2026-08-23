export type EnrichmentTier = "cheap" | "moderate" | "expensive";

export const ENRICHMENT_JOBS = {
  languageId: "cheap",
  parse: "cheap",
  index: "cheap",
  smartTagTier1: "cheap",
  smartTagTier2: "moderate",
  summarize: "expensive",
  generateCards: "expensive",
  extractConcepts: "expensive",
} as const satisfies Record<string, EnrichmentTier>;

export type EnrichmentJob = keyof typeof ENRICHMENT_JOBS;

/** Automatic import path: cheap jobs only. */
export const DEFAULT_IMPORT_ENRICHMENT: readonly EnrichmentJob[] = [
  "languageId",
  "parse",
  "index",
  "smartTagTier1",
];

export function isAllowedOnAutomaticImport(job: EnrichmentJob): boolean {
  return ENRICHMENT_JOBS[job] === "cheap";
}

export function filterAutomaticImportJobs(jobs: readonly EnrichmentJob[]): EnrichmentJob[] {
  return jobs.filter(isAllowedOnAutomaticImport);
}

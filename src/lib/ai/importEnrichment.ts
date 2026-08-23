import { DEFAULT_IMPORT_ENRICHMENT, filterAutomaticImportJobs, type EnrichmentJob } from "./enrichmentPolicy";
import type { LanguageIdProvider } from "./capabilities/language";

export interface CheapImportMetadata {
  language?: string;
  jobs: readonly EnrichmentJob[];
}

/** Automatic import: cheap jobs only. Summaries/cards stay user-requested. */
export async function runCheapImportEnrichment(
  text: string,
  languageId?: LanguageIdProvider
): Promise<CheapImportMetadata> {
  const jobs = filterAutomaticImportJobs(DEFAULT_IMPORT_ENRICHMENT);
  let language: string | undefined;
  if (jobs.includes("languageId") && languageId && text.trim()) {
    language = (await languageId.identifyLanguage(text)).language;
  }
  return { language, jobs };
}

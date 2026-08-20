import { contentFingerprint } from "../languageProcessing/fingerprints";
import type { GeneratedLanguageDocument, LanguageContentGenerationRequest, LanguageContentGenerator } from "./types";

export class LanguageContentGenerationService {
  constructor(private readonly generators: readonly LanguageContentGenerator[] = []) {}

  async generate(request: LanguageContentGenerationRequest): Promise<GeneratedLanguageDocument> {
    if (request.signal?.aborted) throw new Error("cancelled");
    if (!request.topic.trim() || request.learnerContext.profileId !== request.profileId) throw new Error("invalid-language-generation-context");
    const generator = this.generators.find((candidate) => candidate.supports(request.action));
    if (!generator) throw new Error("no-language-content-generator");
    const result = await generator.generate(request);
    if (result.profileId !== request.profileId || result.targetLanguage !== request.targetLanguage) throw new Error("generator-provenance-mismatch");
    return { ...result, generatedFingerprint: result.generatedFingerprint || contentFingerprint(result.content) };
  }
}

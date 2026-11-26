import { contentFingerprint } from "../languageProcessing/fingerprints";
import type {
  GeneratedLanguageDocument,
  LanguageContentGenerationRequest,
  LanguageContentGenerator,
} from "./types";

export class LanguageContentGenerationService {
  constructor(private readonly generators: readonly LanguageContentGenerator[] = []) {}

  async generate(request: LanguageContentGenerationRequest): Promise<GeneratedLanguageDocument> {
    if (request.signal?.aborted) throw new Error("cancelled");
    const hasTopicOrSource = Boolean(request.topic.trim() || request.sourceText?.trim());
    if (!hasTopicOrSource || request.learnerContext.profileId !== request.profileId) {
      throw new Error("invalid-language-generation-context");
    }
    const generator = this.generators.find((candidate) => candidate.supports(request.action));
    if (!generator) throw new Error("no-language-content-generator");

    const result = await generator.generate(request);
    if (request.signal?.aborted) throw new Error("cancelled");

    if (result.profileId !== request.profileId || result.targetLanguage !== request.targetLanguage) {
      throw new Error("generator-provenance-mismatch");
    }
    if (request.sourceDocumentId && result.documentId === request.sourceDocumentId) {
      throw new Error("adaptation-must-not-overwrite-source");
    }
    if ((request.privacy === "local-only" || request.allowCloud === false) && result.provenance.privacy === "allow-cloud") {
      throw new Error("cloud-ai-not-permitted");
    }

    const sourceFingerprint =
      result.sourceFingerprint ??
      request.sourceFingerprint ??
      (request.sourceText ? contentFingerprint(request.sourceText) : undefined);

    return {
      ...result,
      sourceDocumentId: result.sourceDocumentId ?? request.sourceDocumentId,
      sourceFingerprint,
      generatedFingerprint: result.generatedFingerprint || contentFingerprint(result.content),
    };
  }
}

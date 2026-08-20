import type { ReadingAssistKind, ReadingAssistProvider, ReadingAssistRequest, ReadingAssistResult } from "./types";

export class ReadingAssistRegistry {
  private readonly providers = new Map<string, ReadingAssistProvider>();
  private readonly cache = new Map<string, ReadingAssistResult>();

  register(provider: ReadingAssistProvider): void {
    this.providers.set(provider.capabilities.providerId, provider);
  }

  cacheKey(request: ReadingAssistRequest, provider: ReadingAssistProvider): string {
    return [request.profileId ?? "-", request.sourceId, request.contentFingerprint, request.languageTag.toLowerCase(), request.kind, provider.capabilities.providerId, provider.capabilities.providerVersion].join("\u001f");
  }

  async run(request: ReadingAssistRequest, signal?: AbortSignal): Promise<ReadingAssistResult> {
    const provider = [...this.providers.values()].find((candidate) =>
      candidate.capabilities.kinds.includes(request.kind) &&
      candidate.capabilities.languages.some((language) => request.languageTag.toLowerCase().startsWith(language.toLowerCase())) &&
      request.text.length <= candidate.capabilities.maxCodeUnits,
    );
    if (!provider) {
      return { sourceId: request.sourceId, contentFingerprint: request.contentFingerprint, profileId: request.profileId, kind: request.kind, direction: request.direction ?? "ltr", status: "unsupported", providerId: "none", providerVersion: "none", spans: [], createdAt: Date.now(), error: "unsupported-capability" };
    }
    const key = this.cacheKey(request, provider);
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (signal?.aborted) return { sourceId: request.sourceId, contentFingerprint: request.contentFingerprint, profileId: request.profileId, kind: request.kind, direction: request.direction ?? "ltr", status: "failed", providerId: provider.capabilities.providerId, providerVersion: provider.capabilities.providerVersion, spans: [], createdAt: Date.now(), error: "cancelled" };
    const result = await provider.assist(request, signal);
    if (result.contentFingerprint === request.contentFingerprint && result.status === "ready") this.cache.set(key, result);
    return result;
  }

  clear(): void { this.cache.clear(); }
}

export function createIdentityAssistProvider(capabilities: ReadingAssistProvider["capabilities"], transform: (text: string, kind: ReadingAssistKind) => readonly { start: number; end: number; annotation?: string; renderedText?: string }[]): ReadingAssistProvider {
  return {
    capabilities,
    async assist(request) {
      return {
        sourceId: request.sourceId,
        contentFingerprint: request.contentFingerprint,
        profileId: request.profileId,
        kind: request.kind,
        direction: request.direction ?? "ltr",
        status: "ready",
        providerId: capabilities.providerId,
        providerVersion: capabilities.providerVersion,
        spans: transform(request.text, request.kind).map((span, index) => ({ id: `${request.sourceId}:${span.start}:${span.end}:${index}`, sourceStart: span.start, sourceEnd: span.end, sourceText: request.text.slice(span.start, span.end), annotation: span.annotation, renderedText: span.renderedText })),
        createdAt: Date.now(),
      };
    },
  };
}

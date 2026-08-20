import type { LanguageTutorProvider, TutorRequest, TutorResponse, TutorMode } from "./types";

export class LanguageTutorService {
  private readonly providers: LanguageTutorProvider[];
  private readonly inFlight = new Map<string, Promise<TutorResponse>>();

  constructor(providers: readonly LanguageTutorProvider[] = []) {
    this.providers = [...providers];
  }

  async respond(request: TutorRequest): Promise<TutorResponse> {
    if (request.signal?.aborted) throw new Error("cancelled");
    const provider = this.providers.find((candidate) => candidate.supports(request.mode));
    if (!provider) throw new Error("no-language-tutor-provider");
    const key = [request.profileId, request.mode, request.message.trim(), provider.id, provider.version].join("\u001f");
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = provider.respond(request).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  supports(mode: TutorMode): boolean {
    return this.providers.some((provider) => provider.supports(mode));
  }
}

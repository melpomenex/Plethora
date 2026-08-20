import type { PhraseCandidate, PhraseCandidateInput } from "./types";
import { normalizePhrase, phraseKey } from "./types";

export interface PhraseCandidateProvider {
  id: string;
  version: string;
  supports(languageTag: string): boolean;
  propose(input: {
    profileId: string;
    languageTag: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<readonly PhraseCandidateInput[]>;
}

export interface PhraseCandidatePolicy {
  enabled: boolean;
  allowRemoteProviders: boolean;
  minConfidence: number;
  maxCandidates: number;
}

export const DEFAULT_PHRASE_CANDIDATE_POLICY: PhraseCandidatePolicy = {
  enabled: true,
  allowRemoteProviders: false,
  minConfidence: 0.7,
  maxCandidates: 32,
};

export function acceptPhraseCandidate(
  input: PhraseCandidateInput,
  policy: PhraseCandidatePolicy = DEFAULT_PHRASE_CANDIDATE_POLICY,
  now = Date.now(),
): PhraseCandidate | null {
  const surface = input.surface.trim();
  const normalizedForm = normalizePhrase(surface);
  if (!policy.enabled || !surface || !normalizedForm || input.constituents.length < 2) return null;
  if (!Number.isFinite(input.confidence) || input.confidence < policy.minConfidence) return null;
  return {
    id: `phrase-candidate:${phraseKey(input.profileId, "", normalizedForm)}`,
    profileId: input.profileId,
    surface,
    normalizedForm,
    constituents: input.constituents,
    sourceAnchor: input.sourceAnchor,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

export async function collectPhraseCandidates(
  provider: PhraseCandidateProvider,
  input: Parameters<PhraseCandidateProvider["propose"]>[0],
  policy: PhraseCandidatePolicy = DEFAULT_PHRASE_CANDIDATE_POLICY,
): Promise<PhraseCandidate[]> {
  if (!policy.enabled || !provider.supports(input.languageTag)) return [];
  const proposed = await provider.propose(input);
  return proposed
    .map((candidate) => acceptPhraseCandidate(candidate, policy))
    .filter((candidate): candidate is PhraseCandidate => Boolean(candidate))
    .slice(0, Math.max(0, policy.maxCandidates));
}

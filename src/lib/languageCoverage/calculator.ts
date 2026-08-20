import { canonicalStableJson, digestText128 } from "../languageProcessing/fingerprints";
import {
  COVERAGE_STATE_PRECEDENCE,
  DEFAULT_COVERAGE_POLICY,
  type CoverageAnalysisMethod,
  type CoverageChunkInput,
  type CoverageChunkResult,
  type CoverageCountingUnit,
  type CoverageDifficultySignals,
  type CoverageDocumentInput,
  type CoverageExclusionCounts,
  type CoverageKnowledgeState,
  type CoveragePhraseCandidate,
  type CoverageStateCounts,
  type CoverageStateSource,
  type CoverageSummary,
  type CoverageTokenInput,
  type CoverageVersion,
  type InputKnowledgeState,
  type LexicalCoveragePolicy,
  type UnresolvedReason,
} from "./types";

const COUNTED_STATES: readonly CoverageKnowledgeState[] = ["known", "familiar", "learning", "new", "unresolved"];

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeWeight(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback;
}

function normalizedPolicy(input: LexicalCoveragePolicy): LexicalCoveragePolicy {
  const fallback = DEFAULT_COVERAGE_POLICY;
  return {
    ...fallback,
    ...input,
    lowConfidenceThreshold: clamp(input.lowConfidenceThreshold ?? fallback.lowConfidenceThreshold),
    phraseMinConfidence: clamp(input.phraseMinConfidence ?? fallback.phraseMinConfidence),
    phraseWeight: safeWeight(input.phraseWeight, fallback.phraseWeight),
    properNounWeight: safeWeight(input.properNounWeight, fallback.properNounWeight),
    numberWeight: safeWeight(input.numberWeight, fallback.numberWeight),
    stateWeights: { ...fallback.stateWeights, ...input.stateWeights },
    difficultyWeights: { ...fallback.difficultyWeights, ...input.difficultyWeights },
    bands: input.bands ?? fallback.bands,
  };
}

function normalizeState(state: InputKnowledgeState | undefined): CoverageKnowledgeState | undefined {
  if (state === undefined) return undefined;
  if (state === "encountered") return "new";
  if (state === "ignored") return "unresolved";
  return state;
}

function confidenceValue(value: number | null | undefined): number {
  if (value === null) return 0;
  if (value === undefined) return 1;
  return clamp(value);
}

function isLowConfidence(value: number | null | undefined, policy: LexicalCoveragePolicy): boolean {
  return value === null || (value !== undefined && confidenceValue(value) < policy.lowConfidenceThreshold);
}

function sourceState(input: {
  exactFormState?: InputKnowledgeState;
  state?: InputKnowledgeState;
  lemmaState?: InputKnowledgeState;
  phraseState?: InputKnowledgeState;
  phrase?: boolean;
}): { state?: CoverageKnowledgeState; source: CoverageStateSource } {
  // Keep this explicit: changing the order silently changes existing reports.
  const candidates: Array<["exact-form" | "lemma" | "phrase", InputKnowledgeState | undefined]> = [
    ["exact-form", input.exactFormState ?? input.state],
    ["lemma", input.lemmaState],
    ["phrase", input.phraseState],
  ];
  for (const [source, state] of candidates) {
    if (state !== undefined) return { state: normalizeState(state), source };
  }
  return { source: "fallback" };
}

function emptyStateCounts(): CoverageStateCounts {
  return { known: 0, familiar: 0, learning: 0, new: 0, unresolved: 0 };
}

function emptyExclusions(): CoverageExclusionCounts {
  return {
    punctuation: 0,
    symbols: 0,
    nonLexical: 0,
    numbers: 0,
    properNouns: 0,
    ignored: 0,
    lowConfidence: 0,
    invalidPhrases: 0,
  };
}

function addReason(
  reasons: Partial<Record<UnresolvedReason, number>>,
  reason: UnresolvedReason,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort();
}

function entryIdsForToken(token: CoverageTokenInput): string[] {
  return unique([
    token.lexicalEntryId ?? "",
    token.exactFormEntryId ?? "",
    token.lemmaEntryId ?? "",
  ]);
}

function entryIdsForPhrase(phrase: CoveragePhraseCandidate): string[] {
  return unique([
    phrase.lexicalEntryId ?? "",
    phrase.exactFormEntryId ?? "",
    phrase.lemmaEntryId ?? "",
  ]);
}

function tokenPosition(token: CoverageTokenInput, index: number): number {
  return token.start ?? index;
}

function phrasePosition(
  phrase: CoveragePhraseCandidate,
  tokenPositions: ReadonlyMap<string, number>,
): number {
  if (phrase.start !== undefined) return phrase.start;
  return Math.min(...phrase.tokenIds.map((tokenId) => tokenPositions.get(tokenId) ?? Number.MAX_SAFE_INTEGER));
}

function selectedPhrases(
  chunk: CoverageChunkInput,
  policy: LexicalCoveragePolicy,
): { selected: CoveragePhraseCandidate[]; invalidCount: number } {
  if (policy.countingUnitMode !== "phrase-aware" || policy.phraseOverlap === "disabled") {
    return { selected: [], invalidCount: 0 };
  }

  const tokens = new Map(chunk.tokens.map((token, index) => [token.id, { token, index }]));
  const tokenPositions = new Map(chunk.tokens.map((token, index) => [token.id, tokenPosition(token, index)]));
  let invalidCount = 0;
  const candidates = (chunk.phrases ?? []).filter((phrase) => {
    const valid = phrase.tokenIds.length > 0 && phrase.tokenIds.every((tokenId) => tokens.has(tokenId));
    if (!valid) invalidCount += 1;
    return valid && confidenceValue(phrase.confidence) >= policy.phraseMinConfidence;
  });

  candidates.sort((left, right) => {
    const tokenLength = right.tokenIds.length - left.tokenIds.length;
    if (tokenLength !== 0) return tokenLength;
    const confidence = confidenceValue(right.confidence) - confidenceValue(left.confidence);
    if (confidence !== 0) return confidence;
    const position = phrasePosition(left, tokenPositions) - phrasePosition(right, tokenPositions);
    if (position !== 0) return position;
    return left.id.localeCompare(right.id);
  });

  const usedTokens = new Set<string>();
  const selected: CoveragePhraseCandidate[] = [];
  for (const phrase of candidates) {
    if (phrase.tokenIds.some((tokenId) => usedTokens.has(tokenId))) continue;
    selected.push(phrase);
    phrase.tokenIds.forEach((tokenId) => usedTokens.add(tokenId));
  }
  selected.sort((left, right) => phrasePosition(left, tokenPositions) - phrasePosition(right, tokenPositions) || left.id.localeCompare(right.id));
  return { selected, invalidCount };
}

function resolveUnitState(
  input: CoverageTokenInput | CoveragePhraseCandidate,
  policy: LexicalCoveragePolicy,
  phrase = false,
): { state: CoverageKnowledgeState; source: CoverageStateSource; unresolvedReason?: UnresolvedReason } {
  const resolved = sourceState({
    exactFormState: input.exactFormState,
    state: input.state,
    lemmaState: input.lemmaState,
    phraseState: phrase ? input.state : undefined,
  });
  const exactOverrideExists = input.exactFormState !== undefined || input.state !== undefined;
  if (!exactOverrideExists && isLowConfidence(input.confidence, policy)) {
    if (policy.lowConfidenceTreatment === "exclude") {
      return { state: "unresolved", source: "fallback", unresolvedReason: "low-confidence" };
    }
    return { state: "unresolved", source: "fallback", unresolvedReason: "low-confidence" };
  }
  if (resolved.state) {
    return { state: resolved.state, source: resolved.source };
  }
  return {
    state: phrase ? "unresolved" : "new",
    source: "fallback",
    unresolvedReason: phrase ? "phrase-analysis" : undefined,
  };
}

function unitFromToken(
  token: CoverageTokenInput,
  policy: LexicalCoveragePolicy,
): { unit?: CoverageCountingUnit; exclusion?: keyof CoverageExclusionCounts; reason?: UnresolvedReason } {
  if (token.kind === "punctuation") return { exclusion: "punctuation" };
  if (token.kind === "symbol") return { exclusion: "symbols" };
  if (token.isLexical === false) return { exclusion: "nonLexical" };
  if (token.kind === "other") return { exclusion: "nonLexical" };
  if (token.kind === "number" && !policy.countNumbers) return { exclusion: "numbers" };
  if (token.properNoun && !policy.countProperNouns) return { exclusion: "properNouns" };

  if (token.ignored) {
    if (policy.ignoredTermTreatment === "exclude") return { exclusion: "ignored" };
  }

  const resolution = resolveUnitState(token, policy);
  const lowConfidence = resolution.unresolvedReason === "low-confidence";
  if (lowConfidence && policy.lowConfidenceTreatment === "exclude") {
    return { exclusion: "lowConfidence", reason: "low-confidence" };
  }

  const weight = (token.kind === "number" ? policy.numberWeight : 1) * (token.properNoun ? policy.properNounWeight : 1);
  return {
    reason: resolution.unresolvedReason,
    unit: {
      id: token.id,
      kind: "token",
      surface: token.surface,
      normalized: token.normalized,
      lemma: token.lemma,
      tokenIds: [token.id],
      tokenCount: 1,
      weight,
      state: token.ignored ? "unresolved" : resolution.state,
      stateSource: token.ignored ? "fallback" : resolution.source,
      confidence: token.confidence,
      lexicalEntryId: token.exactFormEntryId ?? token.lemmaEntryId ?? token.lexicalEntryId,
      unresolvedReason: token.ignored ? "missing-knowledge-state" : resolution.unresolvedReason,
      properNoun: token.properNoun,
    },
  };
}

function unitFromPhrase(
  phrase: CoveragePhraseCandidate,
  tokens: ReadonlyMap<string, CoverageTokenInput>,
  policy: LexicalCoveragePolicy,
): { unit?: CoverageCountingUnit; exclusion?: keyof CoverageExclusionCounts; reason?: UnresolvedReason } {
  const tokenValues = phrase.tokenIds.map((tokenId) => tokens.get(tokenId)).filter(Boolean) as CoverageTokenInput[];
  const resolution = resolveUnitState({ ...phrase, lemmaState: phrase.lemmaState }, policy, true);
  if (resolution.unresolvedReason === "low-confidence" && policy.lowConfidenceTreatment === "exclude") {
    return { exclusion: "lowConfidence", reason: "low-confidence" };
  }
  const weight = tokenValues.length * policy.phraseWeight;
  return {
    reason: resolution.unresolvedReason,
    unit: {
      id: phrase.id,
      kind: "phrase",
      surface: phrase.surface,
      normalized: phrase.normalized,
      tokenIds: phrase.tokenIds,
      tokenCount: tokenValues.length,
      weight,
      state: resolution.state,
      stateSource: resolution.source,
      confidence: phrase.confidence,
      lexicalEntryId: phrase.exactFormEntryId ?? phrase.lemmaEntryId ?? phrase.lexicalEntryId,
      unresolvedReason: resolution.unresolvedReason,
    },
  };
}

function addUnit(
  units: CoverageCountingUnit[],
  counts: CoverageStateCounts,
  reasons: Partial<Record<UnresolvedReason, number>>,
  unit: CoverageCountingUnit,
  reason?: UnresolvedReason,
): void {
  units.push(unit);
  counts[unit.state] += 1;
  if (reason) addReason(reasons, reason);
}

/** Calculate one chunk without deduplicating repeated forms. */
export function calculateCoverageChunk(
  chunk: CoverageChunkInput,
  inputPolicy: LexicalCoveragePolicy,
): CoverageChunkResult {
  const policy = normalizedPolicy(inputPolicy);
  const tokenMap = new Map(chunk.tokens.map((token) => [token.id, token]));
  const phraseSelection = selectedPhrases(chunk, policy);
  const selectedTokenIds = new Set(phraseSelection.selected.flatMap((phrase) => phrase.tokenIds));
  const units: CoverageCountingUnit[] = [];
  const stateCounts = emptyStateCounts();
  const excluded = emptyExclusions();
  excluded.invalidPhrases = phraseSelection.invalidCount;
  const unresolvedReasons: Partial<Record<UnresolvedReason, number>> = {};

  for (const phrase of phraseSelection.selected) {
    const result = unitFromPhrase(phrase, tokenMap, policy);
    if (result.exclusion) excluded[result.exclusion] += 1;
    if (result.unit) addUnit(units, stateCounts, unresolvedReasons, result.unit, result.reason);
    if (result.reason === "low-confidence") excluded.lowConfidence += 1;
  }

  for (const token of chunk.tokens) {
    if (selectedTokenIds.has(token.id)) continue;
    const result = unitFromToken(token, policy);
    if (result.exclusion) excluded[result.exclusion] += 1;
    if (result.unit) addUnit(units, stateCounts, unresolvedReasons, result.unit, result.reason);
    if (result.reason === "low-confidence") excluded.lowConfidence += 1;
  }

  const orderedUnits = units.sort((left, right) => {
    const leftTokenIndex = chunk.tokens.findIndex((token) => token.id === left.tokenIds[0]);
    const rightTokenIndex = chunk.tokens.findIndex((token) => token.id === right.tokenIds[0]);
    return leftTokenIndex - rightTokenIndex || left.id.localeCompare(right.id);
  });
  const referencedEntryIds = unique([
    ...chunk.tokens.flatMap(entryIdsForToken),
    ...phraseSelection.selected.flatMap(entryIdsForPhrase),
  ]);
  const uniqueLemmaKeys = unique(orderedUnits.map((unit) => unit.lemma || unit.normalized));
  return {
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    units: orderedUnits,
    stateCounts,
    totalWeight: orderedUnits.reduce((sum, unit) => sum + unit.weight, 0),
    countedTokenCount: orderedUnits.reduce((sum, unit) => sum + unit.tokenCount, 0),
    uniqueLemmaKeys,
    referencedEntryIds,
    excluded,
    unresolvedReasons,
    selectedPhraseIds: phraseSelection.selected.map((phrase) => phrase.id),
  };
}

export function createCoverageVersion(input: CoverageDocumentInput): CoverageVersion {
  const policyVersion = `${input.policy.id}@${input.policy.version}`;
  const thresholdVersion = input.thresholdVersion ?? input.policy.bands.version;
  const languageTag = input.languageTag.trim().toLowerCase();
  const keyMaterial = {
    contractVersion: "1.0.0",
    documentId: input.documentId,
    profileId: input.profileId,
    languageTag,
    contentFingerprint: input.contentFingerprint,
    processorVersion: input.processorVersion,
    lexiconStateVersion: input.lexiconStateVersion,
    policyVersion,
    thresholdVersion,
  };
  return { ...keyMaterial, coverageKey: `coverage_${digestText128(canonicalStableJson(keyMaterial)).slice(0, 32)}` };
}

function emptyExclusionAccumulator(): CoverageExclusionCounts {
  return emptyExclusions();
}

function addExclusions(target: CoverageExclusionCounts, source: CoverageExclusionCounts): void {
  for (const key of Object.keys(target) as Array<keyof CoverageExclusionCounts>) target[key] += source[key];
}

function addStateCounts(target: CoverageStateCounts, source: CoverageStateCounts): void {
  for (const state of COUNTED_STATES) target[state] += source[state];
}

function inferMethod(input: CoverageDocumentInput): CoverageAnalysisMethod {
  if (input.analysisMethod) return input.analysisMethod;
  const hasLemmaData = input.chunks.some((chunk) => chunk.tokens.some((token) => token.lemma || token.lemmaState !== undefined));
  return hasLemmaData ? "lemma-aware" : "exact-form-fallback";
}

function chooseBand(score: number, bands: LexicalCoveragePolicy["bands"]): { id: string; label: string } {
  const sorted = [...bands.bands].sort((left, right) => left.minDifficultyScore - right.minDifficultyScore || left.id.localeCompare(right.id));
  return sorted.find((band) => score >= band.minDifficultyScore && score < band.maxDifficultyScore) ??
    (score < (sorted[0]?.minDifficultyScore ?? 0) ? sorted[0] : sorted.at(-1)) ??
    { id: "unconfigured", label: "Unconfigured" };
}

function summarize(
  input: CoverageDocumentInput,
  version: CoverageVersion,
  chunks: readonly CoverageChunkResult[],
  computedAt: number,
): CoverageSummary {
  const policy = normalizedPolicy(input.policy);
  const stateCounts = emptyStateCounts();
  const excluded = emptyExclusionAccumulator();
  const allUnits = chunks.flatMap((chunk) => chunk.units);
  const reasons: Partial<Record<UnresolvedReason, number>> = {};
  for (const chunk of chunks) {
    addStateCounts(stateCounts, chunk.stateCounts);
    addExclusions(excluded, chunk.excluded);
    for (const [reason, count] of Object.entries(chunk.unresolvedReasons)) {
      reasons[reason as UnresolvedReason] = (reasons[reason as UnresolvedReason] ?? 0) + (count ?? 0);
    }
  }
  const totalWeight = allUnits.reduce((sum, unit) => sum + unit.weight, 0);
  const totalCountedTokens = allUnits.reduce((sum, unit) => sum + unit.tokenCount, 0);
  const weightedCoverage = allUnits.reduce((sum, unit) => sum + unit.weight * policy.stateWeights[unit.state], 0);
  const knownWeight = allUnits.filter((unit) => unit.state === "known").reduce((sum, unit) => sum + unit.weight, 0);
  const unresolvedWeight = allUnits.filter((unit) => unit.state === "unresolved").reduce((sum, unit) => sum + unit.weight, 0);
  const unknownWeight = allUnits.filter((unit) => unit.state === "new" || unit.state === "unresolved").reduce((sum, unit) => sum + unit.weight, 0);
  const phraseUnits = allUnits.filter((unit) => unit.kind === "phrase");
  const phraseDifficultyWeight = phraseUnits.reduce((sum, unit) => sum + unit.weight * (1 - policy.stateWeights[unit.state]), 0);
  const phraseTotalWeight = phraseUnits.reduce((sum, unit) => sum + unit.weight, 0);
  const denominator = totalWeight || 1;
  const difficultySignals: CoverageDifficultySignals = {
    lexicalGap: round(100 - (weightedCoverage / denominator) * 100),
    unresolvedDensity: round((unresolvedWeight / denominator) * 100),
    phraseDifficulty: round(phraseTotalWeight === 0 ? 0 : (phraseDifficultyWeight / phraseTotalWeight) * 100),
    documentLength: round(Math.min(100, (totalCountedTokens / 1000) * 100)),
  };
  const signalWeights = policy.difficultyWeights;
  const weightTotal = Object.values(signalWeights).reduce((sum, weight) => sum + safeWeight(weight, 0), 0) || 1;
  const difficultyScore = round(clamp(
    (difficultySignals.lexicalGap * signalWeights.lexicalGap +
      difficultySignals.unresolvedDensity * signalWeights.unresolvedDensity +
      difficultySignals.phraseDifficulty * signalWeights.phraseDifficulty +
      difficultySignals.documentLength * signalWeights.documentLength) / weightTotal,
    0,
    100,
  ));
  const band = chooseBand(difficultyScore, policy.bands);
  return {
    freshness: "fresh",
    version,
    method: inferMethod(input),
    computedAt,
    totalCountedUnits: allUnits.length,
    totalCountedTokens,
    totalWeight: round(totalWeight),
    stateCounts,
    excluded,
    knownCoveragePercent: round((knownWeight / denominator) * 100),
    coveragePercent: round((weightedCoverage / denominator) * 100),
    unknownPercent: round((unknownWeight / denominator) * 100),
    unresolvedPercent: round((unresolvedWeight / denominator) * 100),
    unresolvedCount: stateCounts.unresolved,
    uniqueLemmaCount: unique(allUnits.map((unit) => unit.lemma || unit.normalized)).length,
    phraseCount: phraseUnits.length,
    difficultyScore,
    difficultyBand: band.id,
    difficultyLabel: band.label,
    difficultySignals,
  };
}

/** Aggregate already-calculated chunks; useful for chunked background jobs. */
export function aggregateCoverageChunks(
  input: CoverageDocumentInput,
  chunks: readonly CoverageChunkResult[],
  computedAt = Date.now(),
): { version: CoverageVersion; summary: CoverageSummary; chunks: readonly CoverageChunkResult[] } {
  const version = createCoverageVersion(input);
  const ordered = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex || left.chunkId.localeCompare(right.chunkId));
  return { version, summary: summarize(input, version, ordered, computedAt), chunks: ordered };
}

/** Deterministic weighted calculation for a complete document projection. */
export function calculateCoverage(
  input: CoverageDocumentInput,
  options: { now?: () => number } = {},
): { version: CoverageVersion; summary: CoverageSummary; chunks: readonly CoverageChunkResult[] } {
  const chunks = [...input.chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex || left.chunkId.localeCompare(right.chunkId))
    .map((chunk) => calculateCoverageChunk(chunk, input.policy));
  return aggregateCoverageChunks(input, chunks, options.now?.() ?? Date.now());
}

export { COVERAGE_STATE_PRECEDENCE };

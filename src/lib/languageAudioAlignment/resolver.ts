import type { AlignmentResolveResult, AlignmentResolverInput, AlignmentConfidenceTier, ReplayResult, SentenceAudioAlignment } from "./types";

function tierForConfidence(confidence: number): AlignmentConfidenceTier {
  if (confidence >= 0.95) return "exact";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.65) return "medium";
  if (confidence >= 0.4) return "low";
  return "unusable";
}

export class AudioAlignmentRegistry {
  private readonly alignments = new Map<string, SentenceAudioAlignment[]>();

  add(alignment: SentenceAudioAlignment): void {
    const key = `${alignment.sourceId}\u001f${alignment.sentenceId}`;
    const current = this.alignments.get(key) ?? [];
    current.push(alignment);
    current.sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
    this.alignments.set(key, current);
  }

  resolve(input: AlignmentResolverInput): AlignmentResolveResult {
    const candidates = this.alignments.get(`${input.sourceId}\u001f${input.sentenceId}`) ?? [];
    const fingerprintMatches = candidates.filter((candidate) =>
      candidate.sourceFingerprint === input.sourceFingerprint &&
      (input.mediaId === undefined || candidate.range.mediaId === input.mediaId) &&
      (input.mediaFingerprint === undefined || candidate.range.mediaFingerprint === input.mediaFingerprint),
    );
    if (fingerprintMatches.length === 0) {
      return candidates.length > 0 ? { kind: "stale", alignment: candidates[0] } : { kind: "fallback", reason: input.mediaId ? "missing" : "unsupported" };
    }
    const usable = fingerprintMatches.filter((candidate) => candidate.status === "ready" && tierForConfidence(candidate.confidence) !== "unusable" && candidate.confidence >= (input.minConfidence ?? 0.65));
    if (usable.length === 0) return { kind: "fallback", reason: "low-confidence" };
    if (usable.length > 1 && Math.abs(usable[0]!.confidence - usable[1]!.confidence) < 0.02) return { kind: "ambiguous", candidates: usable };
    return { kind: "original", alignment: usable[0]!, tier: tierForConfidence(usable[0]!.confidence) };
  }

  list(sourceId: string, sentenceId: string): readonly SentenceAudioAlignment[] {
    return [...(this.alignments.get(`${sourceId}\u001f${sentenceId}`) ?? [])];
  }
}

export async function replayOriginalFirst(input: {
  text: string;
  resolution: AlignmentResolveResult;
  playOriginal: (alignment: SentenceAudioAlignment) => void | Promise<void>;
  speakTts: (text: string) => void | Promise<void>;
}): Promise<ReplayResult> {
  if (input.resolution.kind === "original") {
    try {
      await input.playOriginal(input.resolution.alignment);
      return { kind: "original", mediaId: input.resolution.alignment.range.mediaId, startMs: input.resolution.alignment.range.startMs, endMs: input.resolution.alignment.range.endMs, text: input.text };
    } catch {
      // A stale/deleted media file is a playback failure, not a reason to
      // play a different sentence; TTS is the safe fallback.
    }
  }
  await input.speakTts(input.text);
  return { kind: "tts", text: input.text, reason: input.resolution.kind === "fallback" ? input.resolution.reason : input.resolution.kind };
}

export { tierForConfidence };

import type { PlatformCapabilityDescriptor } from "./types";

export interface TranscriptWord {
  t: string;
  startMs?: number;
  endMs?: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface Transcript {
  segments: TranscriptSegment[];
  language?: string;
  incomplete?: boolean;
}

export interface TranscribeAudioRequest {
  /** App-private file path or content URI already validated by the native plugin. */
  sourceUri: string;
  language?: string;
  signal?: AbortSignal;
}

export interface TranscribeLiveRequest {
  language?: string;
  signal?: AbortSignal;
  onPartial?: (text: string) => void;
  onFinalSegment?: (segment: TranscriptSegment) => void;
}

export interface SpeechProvider {
  readonly id: string;
  getCapability(): Promise<PlatformCapabilityDescriptor>;
  transcribeAudio(req: TranscribeAudioRequest): Promise<Transcript>;
  transcribeLiveAudio?(req: TranscribeLiveRequest): Promise<Transcript>;
}

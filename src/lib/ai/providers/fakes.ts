/**
 * Deterministic fakes for Apple-adjacent surfaces. Language fakes share the
 * existing `FakeAIProvider` shape — do not invent a second AIProvider contract.
 */

import { FakeAIProvider, fakeCapabilities, type FakeResponse } from "../__fixtures__/FakeAIProvider";
import type { AIModelCapabilities } from "./types";

export { FakeAIProvider, fakeCapabilities };

export class FakeLanguageProvider extends FakeAIProvider {
  constructor(
    options: {
      id?: string;
      kind?: "ondevice" | "cloud";
      capabilities?: Partial<AIModelCapabilities>;
      responses?: FakeResponse[];
    } = {}
  ) {
    super({
      id: options.id ?? "fake-apple-foundation",
      kind: options.kind ?? "ondevice",
      capabilities: options.capabilities,
      responses: options.responses,
    });
  }
}

export const FakeAppleFoundationProvider = FakeLanguageProvider;
export const FakeCoreAIProvider = FakeLanguageProvider;

export interface FakeSpeechResult {
  text: string;
  segments: Array<{ id: string; text: string; startMs: number; endMs: number }>;
}

export class FakeSpeechProvider {
  readonly results: FakeSpeechResult[] = [];
  constructor(private readonly script: FakeSpeechResult[] = []) {}
  async transcribeFile(): Promise<FakeSpeechResult> {
    const next = this.script[this.results.length] ?? this.script[this.script.length - 1] ?? {
      text: "",
      segments: [],
    };
    this.results.push(next);
    return next;
  }
}

export interface FakeVisionResult {
  text: string;
  html: string;
  blocks: Array<{ id: string; text: string }>;
}

export class FakeVisionProvider {
  constructor(private readonly result: FakeVisionResult = { text: "", html: "", blocks: [] }) {}
  async recognizeDocument(): Promise<FakeVisionResult> {
    return this.result;
  }
}

export class FakeSemanticSearchProvider {
  constructor(
    private readonly hits: Array<{ identifier: string; uri: string; title: string }> = []
  ) {}
  async query(): Promise<typeof this.hits> {
    return this.hits;
  }
}

import type { PlatformCapabilityDescriptor } from "./types";

export interface IdentifyLanguageResult {
  /** BCP-47 tag, or `und` when undetermined. */
  language: string;
  confidence?: number;
}

export interface LanguageIdProvider {
  readonly id: string;
  getCapability(): Promise<PlatformCapabilityDescriptor>;
  identifyLanguage(text: string): Promise<IdentifyLanguageResult>;
}

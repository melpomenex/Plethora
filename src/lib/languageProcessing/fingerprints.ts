import type {
  AnalysisVersion,
  LanguageTag,
  StaleAnalysis,
} from "./types";
import { LANGUAGE_PROCESSING_CONTRACT_VERSION, LANGUAGE_PROCESSING_SCHEMA_VERSION } from "./types";
import { normalizeForLookup } from "./unicode";

const FNV128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV128_PRIME = 0x1000000000000000000013bn;
const FNV128_MASK = (1n << 128n) - 1n;

/** Stable, synchronous 128-bit-class digest usable in browser and Rust-boundary keys. */
export function digestText128(value: string): string {
  let hash = FNV128_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV128_PRIME) & FNV128_MASK;
  }
  return hash.toString(16).padStart(32, "0");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function digestConfiguration(configuration: Readonly<Record<string, unknown>> = {}): string {
  return digestText128(stableJson(configuration));
}

/** Exposed for tests and persistence implementations that need a canonical key. */
export function canonicalStableJson(value: unknown): string {
  return stableJson(value);
}

export function contentFingerprint(text: string): string {
  // Content identity intentionally preserves exact source characters. NFC is
  // used only for lexical identity, never for invalidation.
  return digestText128(text);
}

export function processingKey(input: {
  contentFingerprint: string;
  languageTag: LanguageTag | string;
  adapterId: string;
  adapterVersion: string;
  configurationFingerprint: string;
  contractVersion?: string;
  schemaVersion?: number;
}): string {
  return [
    `contract=${input.contractVersion ?? LANGUAGE_PROCESSING_CONTRACT_VERSION}`,
    `schema=${input.schemaVersion ?? LANGUAGE_PROCESSING_SCHEMA_VERSION}`,
    `content=${input.contentFingerprint}`,
    `language=${String(input.languageTag).toLowerCase()}`,
    `adapter=${input.adapterId}`,
    `version=${input.adapterVersion}`,
    `config=${input.configurationFingerprint}`,
  ].join("|");
}

export function createAnalysisVersion(input: {
  contentFingerprint: string;
  languageTag: LanguageTag;
  adapterId: string;
  adapterVersion: string;
  providerKind: AnalysisVersion["providerKind"];
  configuration?: Readonly<Record<string, unknown>>;
}): AnalysisVersion {
  const configurationFingerprint = digestConfiguration(input.configuration ?? {});
  const contractVersion = LANGUAGE_PROCESSING_CONTRACT_VERSION;
  const schemaVersion = LANGUAGE_PROCESSING_SCHEMA_VERSION;
  return {
    contractVersion,
    schemaVersion,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    providerKind: input.providerKind,
    languageTag: input.languageTag,
    contentFingerprint: input.contentFingerprint,
    configurationFingerprint,
    processingKey: processingKey({
      contentFingerprint: input.contentFingerprint,
      languageTag: input.languageTag,
      adapterId: input.adapterId,
      adapterVersion: input.adapterVersion,
      configurationFingerprint,
      contractVersion,
      schemaVersion,
    }),
  };
}

export function compareAnalysisVersions(
  previous: AnalysisVersion | null | undefined,
  current: AnalysisVersion,
): StaleAnalysis {
  if (!previous) return { status: "missing", currentKey: current.processingKey };
  if (previous.processingKey === current.processingKey) return { status: "fresh", currentKey: current.processingKey, previousKey: previous.processingKey };
  const reason = previous.contentFingerprint !== current.contentFingerprint
    ? "content"
    : previous.languageTag !== current.languageTag
      ? "language"
      : previous.adapterId !== current.adapterId
        ? "provider"
        : previous.adapterVersion !== current.adapterVersion
          ? "adapter-version"
          : previous.configurationFingerprint !== current.configurationFingerprint
            ? "configuration"
            : "contract";
  return { status: "stale", reason, currentKey: current.processingKey, previousKey: previous.processingKey };
}

export function lexicalIdentity(value: string, languageTag?: LanguageTag | string): string {
  return normalizeForLookup(value, languageTag);
}

export function isAnalysisCurrent(
  previous: AnalysisVersion | null | undefined,
  current: AnalysisVersion,
): boolean {
  return compareAnalysisVersions(previous, current).status === "fresh";
}

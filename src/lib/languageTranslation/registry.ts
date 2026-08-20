import {
  TRANSLATION_PROVIDER_PRIORITY,
  supportsTranslationLanguagePair,
  type TranslationProviderKind,
} from "./capability";
import type { TranslationProvider } from "./provider";
import type { TranslationProviderPolicy } from "./settings";

export type TranslationProviderUnavailableReason =
  | "unsupported-language-pair"
  | "offline"
  | "privacy-blocked"
  | "credentials-required"
  | "unconfigured";

export interface TranslationProviderSelectionCandidate {
  provider: TranslationProvider;
  available: boolean;
  reason?: TranslationProviderUnavailableReason;
}

export interface TranslationProviderSelection {
  provider?: TranslationProvider;
  considered: readonly TranslationProviderSelectionCandidate[];
}

export interface TranslationProviderSelectionInput {
  sourceLanguage: string;
  targetLanguage: string;
  policy: TranslationProviderPolicy;
}

function providerSort(left: TranslationProvider, right: TranslationProvider): number {
  const priority = TRANSLATION_PROVIDER_PRIORITY[left.kind] - TRANSLATION_PROVIDER_PRIORITY[right.kind];
  return priority || left.id.localeCompare(right.id);
}

function orderedProviders(
  providers: readonly TranslationProvider[],
  preferredProviderId?: string,
): TranslationProvider[] {
  const ordered = [...providers].sort(providerSort);
  if (!preferredProviderId) return ordered;
  const preferredIndex = ordered.findIndex((provider) => provider.id === preferredProviderId);
  if (preferredIndex < 0) return ordered;
  const [preferred] = ordered.splice(preferredIndex, 1);
  ordered.unshift(preferred);
  return ordered;
}

function unavailableReason(
  provider: TranslationProvider,
  input: TranslationProviderSelectionInput,
): TranslationProviderUnavailableReason | undefined {
  const { capabilities } = provider;
  if (!supportsTranslationLanguagePair(capabilities, input.sourceLanguage, input.targetLanguage)) {
    return "unsupported-language-pair";
  }
  if (!capabilities.configured) return "unconfigured";
  if (capabilities.requiresCredentials && !capabilities.configured) return "credentials-required";
  if (input.policy.offline && !capabilities.offlineAvailable) return "offline";
  if (input.policy.privacy === "local-only" && capabilities.sendsTextOffDevice) return "privacy-blocked";
  return undefined;
}

/** Registry local to translation; no reader or shared AI registry needs to know its policy. */
export class TranslationProviderRegistry {
  private readonly providers = new Map<string, TranslationProvider>();

  constructor(initial: readonly TranslationProvider[] = []) {
    for (const provider of initial) this.register(provider);
  }

  register(provider: TranslationProvider): void {
    if (!provider.id.trim()) throw new Error("Translation provider id is required");
    if (this.providers.has(provider.id)) throw new Error(`Translation provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  list(): readonly TranslationProvider[] {
    return orderedProviders([...this.providers.values()]);
  }

  select(input: TranslationProviderSelectionInput): TranslationProviderSelection {
    const considered = orderedProviders([...this.providers.values()], input.policy.preferredProviderId).map((provider) => {
      const reason = unavailableReason(provider, input);
      return { provider, available: !reason, reason };
    });
    return {
      provider: considered.find((candidate) => candidate.available)?.provider,
      considered,
    };
  }

  diagnostics(input: TranslationProviderSelectionInput): readonly TranslationProviderSelectionCandidate[] {
    return this.select(input).considered;
  }
}

export function createTranslationProviderRegistry(
  providers: readonly TranslationProvider[] = [],
): TranslationProviderRegistry {
  return new TranslationProviderRegistry(providers);
}

export function providerKindPriority(kind: TranslationProviderKind): number {
  return TRANSLATION_PROVIDER_PRIORITY[kind];
}

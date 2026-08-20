import type {
  LanguageProcessingAdapter,
  LanguageProcessingCapability,
  ProviderDiagnostic,
  ProviderPrivacyPolicy,
} from "./types";
import { canonicalizeLanguageTag } from "./types";
import type { LanguageProcessingAdapterRegistry } from "./registry";

export function privacyPolicy(adapter: LanguageProcessingAdapter): ProviderPrivacyPolicy {
  const userActionRequired = adapter.manifest.requiresCredentials
    ? "configure-credentials"
    : adapter.kind === "cloud"
      ? "enable-cloud"
      : "none";
  return {
    adapterId: adapter.id,
    kind: adapter.kind,
    sendsTextOffDevice: adapter.manifest.sendsTextOffDevice,
    requiresCredentials: adapter.manifest.requiresCredentials,
    disclosure: adapter.manifest.privacyDisclosure,
    userActionRequired,
  };
}

export interface CapabilityDiagnosticSummary {
  languageTag: string;
  selectedAdapterId: string;
  fallbackUsed: boolean;
  providers: readonly ProviderDiagnostic[];
  unavailableCapabilities: readonly string[];
  cloudDisclosure: readonly ProviderPrivacyPolicy[];
}

export function capabilityDiagnostics(
  registry: LanguageProcessingAdapterRegistry,
  languageTag: string,
  options: {
    requiredCapabilities?: readonly LanguageProcessingCapability[];
    allowCloud?: boolean;
    online?: boolean;
    hasCredentials?: (adapter: LanguageProcessingAdapter) => boolean;
  } = {},
): CapabilityDiagnosticSummary {
  const selection = registry.select({
    languageTag,
    requiredCapabilities: options.requiredCapabilities,
    allowCloud: options.allowCloud,
    online: options.online,
  }, options);
  const providers = registry.diagnostics(languageTag, {
    requiredCapabilities: options.requiredCapabilities,
    allowCloud: options.allowCloud,
    online: options.online,
  }, options);
  const selected = selection.adapter.manifest.capabilities;
  const unavailableCapabilities = Object.entries(selected)
    .filter(([, declaration]) => !declaration.supported)
    .map(([name]) => name);
  return {
    languageTag: canonicalizeLanguageTag(languageTag) ?? languageTag,
    selectedAdapterId: selection.adapter.id,
    fallbackUsed: selection.fallbackUsed,
    providers,
    unavailableCapabilities,
    cloudDisclosure: registry.list().filter((adapter) => adapter.kind === "cloud").map(privacyPolicy),
  };
}

export function unavailableProviderMessage(diagnostic: ProviderDiagnostic): string {
  if (diagnostic.unavailableReason === "offline") return `${diagnostic.adapterId} is unavailable while offline.`;
  if (diagnostic.unavailableReason === "credentials-required") return `${diagnostic.adapterId} requires credentials and explicit cloud opt-in.`;
  if (diagnostic.unavailableReason === "unsupported-capability") return `${diagnostic.adapterId} does not provide the requested language capability.`;
  if (diagnostic.unavailableReason === "unsupported-language") return `${diagnostic.adapterId} does not support ${diagnostic.languageTag}.`;
  return `${diagnostic.adapterId} is unavailable.`;
}

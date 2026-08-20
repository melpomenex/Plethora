import { baselineAdapter, exactFormFallbackAdapter } from "./baseline";
import type {
  AdapterContext,
  AdapterSelection,
  AdapterSelectionRequest,
  LanguageProcessingAdapter,
  LanguageProcessingCapability,
  ProviderDiagnostic,
} from "./types";
import { canonicalizeLanguageTag } from "./types";

function supportsLanguage(adapter: LanguageProcessingAdapter, languageTag: string): boolean {
  const canonical = canonicalizeLanguageTag(languageTag);
  if (!canonical) return false;
  return adapter.manifest.supportedLanguageTags.some((supported) =>
    supported === "*" || supported.toLowerCase() === canonical.toLowerCase() ||
    canonical.toLowerCase().startsWith(`${supported.toLowerCase()}-`),
  );
}

function capabilityAvailable(
  adapter: LanguageProcessingAdapter,
  capabilities: readonly LanguageProcessingCapability[],
): boolean {
  return capabilities.every((capability) => adapter.manifest.capabilities[capability]?.supported === true);
}

function defaultCapabilities(request: AdapterSelectionRequest): readonly LanguageProcessingCapability[] {
  return request.requiredCapabilities?.length
    ? request.requiredCapabilities
    : ["sentenceSegment", "tokenize", "normalize", "script"];
}

function unavailableReason(
  adapter: LanguageProcessingAdapter,
  request: AdapterSelectionRequest,
  context: AdapterContext,
): "unsupported-language" | "unsupported-capability" | "offline" | "credentials-required" | undefined {
  if (!supportsLanguage(adapter, String(request.languageTag))) return "unsupported-language";
  if (!capabilityAvailable(adapter, defaultCapabilities(request))) return "unsupported-capability";
  if (!context.online && adapter.kind === "cloud") return "offline";
  if (adapter.manifest.requiresCredentials && !context.hasCredentials?.(adapter)) return "credentials-required";
  if (adapter.kind === "cloud" && !context.allowCloud) return "credentials-required";
  return undefined;
}

/**
 * Ordered adapter registry. The order is an explicit privacy and determinism
 * policy: local, bundled, configured cloud, then exact-form fallback.
 */
export class LanguageProcessingAdapterRegistry {
  private readonly adapters = new Map<string, LanguageProcessingAdapter>();

  constructor(initial: readonly LanguageProcessingAdapter[] = [baselineAdapter, exactFormFallbackAdapter]) {
    for (const adapter of initial) this.register(adapter);
  }

  register(adapter: LanguageProcessingAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Language adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  unregister(adapterId: string): boolean {
    return this.adapters.delete(adapterId);
  }

  list(): readonly LanguageProcessingAdapter[] {
    return this.orderedAdapters();
  }

  select(request: AdapterSelectionRequest, context: Partial<AdapterContext> = {}): AdapterSelection {
    const resolvedContext: AdapterContext = {
      online: context.online ?? true,
      allowCloud: context.allowCloud ?? request.allowCloud ?? false,
      hasCredentials: context.hasCredentials,
    };
    const considered: Array<{ adapterId: string; available: boolean; reason?: ReturnType<typeof unavailableReason> }> = [];
    let fallback: LanguageProcessingAdapter | undefined;

    for (const adapter of this.orderedAdapters()) {
      const reason = unavailableReason(adapter, request, resolvedContext);
      const available = !reason && adapter.supports(
        canonicalizeLanguageTag(String(request.languageTag)) ?? (request.languageTag as never),
        defaultCapabilities(request),
      );
      const finalReason = available ? undefined : reason ?? "unsupported-capability";
      considered.push({ adapterId: adapter.id, available, reason: finalReason });
      if (adapter.kind === "exact-form") fallback ??= adapter;
      if (available && adapter.kind !== "exact-form") {
        return { adapter, considered, fallbackUsed: false };
      }
    }

    if (!fallback) {
      // This is only reachable when a caller constructed a registry without
      // its safety net. Make the failure explicit instead of guessing.
      throw new Error("No exact-form fallback adapter is registered");
    }
    return { adapter: fallback, considered, fallbackUsed: true };
  }

  diagnostics(
    languageTag: string,
    request: Omit<AdapterSelectionRequest, "languageTag"> = {},
    context: Partial<AdapterContext> = {},
  ): ProviderDiagnostic[] {
    const selection = this.select({ languageTag, ...request }, context);
    return this.list().map((adapter) => {
      const considered = selection.considered.find((item) => item.adapterId === adapter.id);
      return {
        adapterId: adapter.id,
        kind: adapter.kind,
        languageTag: canonicalizeLanguageTag(languageTag) ?? (languageTag as never),
        selected: selection.adapter.id === adapter.id,
        available: considered?.available ?? false,
        offlineAvailable: Object.values(adapter.manifest.capabilities).some((capability) => capability.offline && capability.supported),
        requiresCredentials: adapter.manifest.requiresCredentials,
        sendsTextOffDevice: adapter.manifest.sendsTextOffDevice,
        capabilities: adapter.manifest.capabilities,
        privacyDisclosure: adapter.manifest.privacyDisclosure,
        unavailableReason: considered?.reason,
      };
    });
  }

  private orderedAdapters(): LanguageProcessingAdapter[] {
    const priority: Record<LanguageProcessingAdapter["kind"], number> = {
      local: 0,
      bundled: 1,
      cloud: 2,
      "exact-form": 3,
    };
    return [...this.adapters.values()].sort((left, right) => priority[left.kind] - priority[right.kind]);
  }
}

export function createDefaultLanguageProcessingRegistry(
  adapters: readonly LanguageProcessingAdapter[] = [],
): LanguageProcessingAdapterRegistry {
  const registry = new LanguageProcessingAdapterRegistry();
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}

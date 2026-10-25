import { useEffect, useId, useRef, type RefObject } from "react";
import { Cpu, Eye, Gear, Globe, Lightning, X, type Icon } from "@phosphor-icons/react";
import { registerOverlayDismissal } from "../../lib/overlayStack";
import { useI18n } from "../../lib/i18n";
import { supportsVision } from "../../utils/visionCapability";
import type { AssistantProviderId } from "../../utils/assistantProvider";
import type { LLMProviderConfig } from "../../stores/llmProvidersStore";
import { cn } from "../../utils/cn";

export type AssistantProviderStatus = "active" | "disabled" | "not-configured" | "key-missing";

export interface AssistantProviderOption {
  id: AssistantProviderId;
  name: string;
  icon: Icon;
  color: string;
  gradient: string;
  breathingDot: string;
}

export interface AssistantModelPickerProps {
  /** Mobile renders as the sheet body; desktop stays an anchored menu. */
  variant: "mobile" | "desktop";
  providers: AssistantProviderOption[];
  configuredProviders: LLMProviderConfig[];
  activeProvider: AssistantProviderId;
  getStatus: (providerId: AssistantProviderId) => AssistantProviderStatus;
  onSelect: (providerId: AssistantProviderId) => void;
  onConfigure: () => void;
  onClose: () => void;
  /** The model control receives focus again when the picker closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  className?: string;
}

const STATUS_KEYS: Record<AssistantProviderStatus, string> = {
  active: "assistant.modelPicker.statusActive",
  disabled: "assistant.modelPicker.statusDisabled",
  "key-missing": "assistant.modelPicker.statusKeyMissing",
  "not-configured": "assistant.modelPicker.statusSetup",
};

const STATUS_BADGE_CLASS: Record<AssistantProviderStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  disabled: "bg-muted text-muted-foreground",
  "key-missing": "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20",
  "not-configured": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
};

/**
 * Shared AI-engine provider picker. Mobile mounts it as an in-flow, bounded
 * sheet body so the list can never outgrow or be clipped by the Assistant
 * sheet; desktop keeps the anchored menu wrapper in `AssistantPanel`.
 */
export function AssistantModelPicker({
  variant,
  providers,
  configuredProviders,
  activeProvider,
  getStatus,
  onSelect,
  onConfigure,
  onClose,
  returnFocusRef,
  className,
}: AssistantModelPickerProps) {
  const { t } = useI18n();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (variant !== "mobile") return;
    // Above the Assistant sheet's own 60 so Back closes the picker first.
    const unregister = registerOverlayDismissal(() => onCloseRef.current(), { priority: 70 });
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => {
      unregister();
      window.cancelAnimationFrame(frame);
    };
  }, [variant]);

  useEffect(() => {
    // Open on the selected engine, not the top of a long list. `nearest` keeps
    // the active row where it is when the whole list already fits.
    const frame = window.requestAnimationFrame(() => {
      const active = listRef.current?.querySelector<HTMLElement>(
        '[data-assistant-provider-option][aria-pressed="true"]',
      );
      const list = listRef.current;
      if (!active || !list) return;
      const bounds = list.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      const scale = bounds.height / list.clientHeight || 1;
      if (row.top < bounds.top) list.scrollTop += (row.top - bounds.top) / scale;
      else if (row.bottom > bounds.bottom) list.scrollTop += (row.bottom - bounds.bottom) / scale;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => {
    const target = returnFocusRef.current;
    if (target?.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  }, [returnFocusRef]);

  const listLabel = t("assistant.modelPicker.title");

  return (
    <div
      data-assistant-model-picker
      data-variant={variant}
      role="group"
      aria-labelledby={headingId}
      className={cn("flex min-h-0 flex-col", variant === "mobile" ? "flex-1" : "overflow-hidden", className)}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border/40",
          variant === "mobile" ? "px-3 py-1.5" : "px-1.5 pb-1",
        )}
      >
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 text-[0.6875rem] font-bold uppercase leading-tight tracking-wider text-muted-foreground outline-none"
        >
          {listLabel}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onConfigure}
            aria-label={t("assistant.modelPicker.manage")}
            title={t("assistant.modelPicker.manage")}
            className={cn(
              "md-state flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
              variant === "mobile" ? "min-h-12 min-w-12" : "min-h-8 min-w-8",
            )}
          >
            <Gear className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {variant === "mobile" && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("assistant.modelPicker.close")}
              title={t("assistant.modelPicker.close")}
              className="md-state flex min-h-12 min-w-12 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        data-assistant-model-list
        className={cn(
          "mt-1 min-h-0 space-y-1.5 overscroll-contain touch-pan-y",
          variant === "mobile"
            ? "flex-1 overflow-y-auto px-2 pb-2"
            : "max-h-[min(55vh,22rem)] overflow-y-auto",
        )}
      >
        {providers.map((provider) => {
          const provConfig = configuredProviders.find((candidate) => candidate.provider === provider.id);
          const status = getStatus(provider.id);
          const isActive = activeProvider === provider.id;
          const statusLabel = t(STATUS_KEYS[status]);
          const hasVision = provConfig ? supportsVision(provider.id, provConfig.model) : false;
          const isMini = provConfig
            ? provConfig.model.toLowerCase().includes("mini") || provConfig.model.toLowerCase().includes("haiku")
            : false;
          const isAppleFm = provider.id === "ondevice-apple-foundation";
          const setupNeeded = status === "not-configured";
          const accessibleName = [
            provider.name,
            provConfig?.model,
            statusLabel,
            setupNeeded ? t("assistant.modelPicker.configureKey") : null,
          ].filter(Boolean).join(", ");

          return (
            <button
              key={provider.id}
              type="button"
              data-assistant-provider-option
              data-provider-id={provider.id}
              data-provider-status={status}
              aria-pressed={setupNeeded ? undefined : isActive}
              aria-label={accessibleName}
              onClick={() => {
                if (setupNeeded) onConfigure();
                else onSelect(provider.id);
              }}
              className={cn(
                "md-state group flex min-h-12 w-full flex-col rounded-lg border p-2.5 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isActive
                  ? `bg-gradient-to-br ${provider.gradient} border-primary/20 shadow-sm`
                  : "border-transparent bg-background/40 hover:border-border/60 hover:bg-muted/40",
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="shrink-0 rounded bg-background/80 p-1 shadow-sm transition-transform duration-200 group-hover:scale-105">
                    <provider.icon className={`h-3.5 w-3.5 ${provider.color}`} aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "text-xs font-bold leading-tight text-foreground",
                      variant === "mobile" ? "break-words" : "truncate",
                    )}
                  >
                    {provider.name}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {isActive && (
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${provider.breathingDot} breathing-pulse`} aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      "whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider",
                      STATUS_BADGE_CLASS[status],
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>

              {(provConfig || isAppleFm) && (
                <div className="mt-2 w-full min-w-0 space-y-1.5 pl-7">
                  {provConfig && (
                    <div
                      className={cn(
                        "text-xs font-mono text-muted-foreground",
                        variant === "mobile" ? "break-all" : "truncate",
                      )}
                      title={provConfig.model}
                    >
                      {provConfig.model}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {hasVision && (
                      <span className="inline-flex items-center gap-0.5 rounded border border-blue-500/10 bg-blue-500/15 px-1 py-0.5 text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                        <Eye className="h-2.5 w-2.5" aria-hidden="true" /> {t("assistant.modelPicker.vision")}
                      </span>
                    )}
                    {isAppleFm ? (
                      <span className="inline-flex items-center gap-0.5 rounded border border-slate-500/10 bg-slate-500/15 px-1 py-0.5 text-[0.6875rem] font-semibold text-slate-600 dark:text-slate-400">
                        <Cpu className="h-2.5 w-2.5" aria-hidden="true" /> {t("assistant.modelPicker.onDevice")}
                      </span>
                    ) : provider.id === "ollama" ? (
                      <span className="inline-flex items-center gap-0.5 rounded border border-cyan-500/10 bg-cyan-500/15 px-1 py-0.5 text-[0.6875rem] font-semibold text-cyan-600 dark:text-cyan-400">
                        <Cpu className="h-2.5 w-2.5" aria-hidden="true" /> {t("assistant.modelPicker.local")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded border border-indigo-500/10 bg-indigo-500/15 px-1 py-0.5 text-[0.6875rem] font-semibold text-indigo-600 dark:text-indigo-400">
                        <Globe className="h-2.5 w-2.5" aria-hidden="true" /> {t("assistant.modelPicker.cloud")}
                      </span>
                    )}
                    {isMini && (
                      <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/10 bg-amber-500/15 px-1 py-0.5 text-[0.6875rem] font-semibold text-amber-600 dark:text-amber-400">
                        <Lightning className="h-2.5 w-2.5" aria-hidden="true" /> {t("assistant.modelPicker.fast")}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {setupNeeded && (
                <div className="mt-1 w-full pl-7 text-start text-xs italic text-muted-foreground">
                  {t("assistant.modelPicker.configureKey")}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

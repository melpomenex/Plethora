import { ASSISTANT_SCOPES, ASSISTANT_SCOPE_METADATA, type AssistantScope } from "../../lib/ai/assistant/scopes";

export function AssistantScopeSelector({ value, onChange, disabled = false, compact = false }: {
  value: AssistantScope; onChange: (scope: AssistantScope) => void; disabled?: boolean; compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Assistant scope" className="inline-flex flex-wrap items-center rounded-full border border-border bg-muted/40 p-0.5">
      {ASSISTANT_SCOPES.map((scope) => (
        <button key={scope} type="button" aria-pressed={value === scope} disabled={disabled}
          title={ASSISTANT_SCOPE_METADATA[scope].shortDescription} onClick={() => onChange(scope)}
          className={`md-state md-hit-slop rounded-full font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${compact ? "min-h-8 px-2 text-[11px]" : "min-h-10 px-3 text-xs"} ${value === scope ? "bg-background text-foreground" : "text-muted-foreground"}`}>
          {value === scope && !compact && <span aria-hidden="true">✓ </span>}{ASSISTANT_SCOPE_METADATA[scope].label}
        </button>
      ))}
    </div>
  );
}

import { useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Menu } from "../md3/Menu";
import { ASSISTANT_SCOPES, ASSISTANT_SCOPE_METADATA, type AssistantScope } from "../../lib/ai/assistant/scopes";

export function AssistantScopeSelector({ value, onChange, disabled = false, compact = false, variant = "segmented" }: {
  value: AssistantScope; onChange: (scope: AssistantScope) => void; disabled?: boolean; compact?: boolean;
  /** "menu" keeps the phone header to one control while staying fully operable. */
  variant?: "segmented" | "menu";
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  if (variant === "menu") {
    return (
      <div className="relative">
        <button
          ref={anchorRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Assistant scope: ${ASSISTANT_SCOPE_METADATA[value].label}`}
          title={ASSISTANT_SCOPE_METADATA[value].shortDescription}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className="md-state flex min-h-10 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 text-[11px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {ASSISTANT_SCOPE_METADATA[value].label}
          <CaretDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </button>
        <Menu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          label="Assistant scope"
          items={ASSISTANT_SCOPES.map((scope) => ({
            key: scope,
            label: ASSISTANT_SCOPE_METADATA[scope].label,
            leading: value === scope ? <span aria-hidden="true">✓</span> : undefined,
            onSelect: () => onChange(scope),
          }))}
        />
      </div>
    );
  }

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

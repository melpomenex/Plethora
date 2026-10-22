import { useId, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Menu } from "../md3/Menu";
import { ASSISTANT_SCOPES, type AssistantScope } from "../../lib/ai/assistant/scopes";
import { useI18n } from "../../lib/i18n";

export function AssistantScopeSelector({ value, onChange, disabled = false, variant = "menu", open: controlledOpen, onOpenChange }: {
  value: AssistantScope;
  onChange: (scope: AssistantScope) => void;
  disabled?: boolean;
  variant?: "menu" | "inline";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState<number>();
  const open = !disabled && (controlledOpen ?? localOpen);
  const setOpen = (next: boolean) => {
    if (next) setMenuWidth(anchorRef.current?.parentElement?.getBoundingClientRect().width);
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    setOpen(false);
    anchorRef.current?.focus();
  };
  const label = t("assistant.answerFrom.label");
  const selectedLabel = t(`assistant.answerFrom.${value}`);

  return (
    <div data-assistant-answer-from className="min-w-0">
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${selectedLabel}`}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="md-state flex min-h-10 [@media(pointer:coarse)]:min-h-12 max-w-full items-center gap-1.5 rounded-lg px-2 text-start text-xs text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <span className="min-w-0 whitespace-normal break-words">
          <span className="text-muted-foreground">{label}: </span>
          <span className="font-medium">{selectedLabel}</span>
        </span>
        <CaretDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      <span id={descriptionId} className="sr-only">{t(`assistant.answerFrom.${value}Hint`)}</span>
      <Menu
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        align="start"
        inline={variant === "inline"}
        dismissPriority={70}
        maxWidth={menuWidth}
        label={label}
        items={sourceChoices(value, onChange, disabled, t)}
      />
    </div>
  );
}

function sourceChoices(value: AssistantScope, onChange: (scope: AssistantScope) => void, disabled: boolean, t: (key: string) => string) {
  return ASSISTANT_SCOPES.map((scope) => ({
    key: scope,
    checked: value === scope,
    disabled,
    label: <span className="block whitespace-normal break-words">
      <span className="block font-medium">{t(`assistant.answerFrom.${scope}`)}</span>
      <span className="block text-xs text-on-surface-variant">{t(`assistant.answerFrom.${scope}Hint`)}</span>
    </span>,
    leading: <Check className={`h-4 w-4 shrink-0 ${value === scope ? "" : "invisible"}`} aria-hidden="true" />,
    onSelect: () => onChange(scope),
  }));
}

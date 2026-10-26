import { useLayoutEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from "react";
import { ChatCircleDots, Images, MagnifyingGlass, ShareNetwork } from "@phosphor-icons/react";
import { useAssistantMenuDismissal } from "../useAssistantMenuDismissal";
import { useI18n } from "../../../lib/i18n";
import { matchAssistantSlashCommands } from "../assistantSlashCommands";
import { MobileAssistantCommands, useAssistantCommandMatches } from "./MobileAssistantCommands";

export interface MobileComposerMenuProps {
  open: boolean;
  actions?: (query: string) => ReactNode;
  actionsMatch?: (query: string) => boolean;
  startAtActions?: boolean;
  /** The add control; dismissal and outside taps keep it as the focus anchor. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  sourceTitle?: string;
  onClose: () => void;
  onInsert: (command: string) => void;
  onAttach: () => void;
  onNewConversation: () => void;
  onShare?: () => void;
}

const SECTION_CLASS = "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const ROW_CLASS = "md-state flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-start focus-visible:outline focus-visible:outline-2";

/**
 * One searchable menu anchored above the composer: attachment, the assistant's
 * slash commands, and the shared command registry. Opening never moves focus
 * into the search field, so the software keyboard is not raised by the menu.
 * The registry only builds while the menu is mounted (open).
 */
export function MobileComposerMenu(props: MobileComposerMenuProps) {
  if (!props.open) return null;
  return <MobileComposerMenuBody {...props} />;
}

function MobileComposerMenuBody({ actions, actionsMatch, startAtActions, anchorRef, sourceTitle, onClose, onInsert, onAttach, onNewConversation, onShare }: MobileComposerMenuProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const slashCommands = useMemo(() => matchAssistantSlashCommands(query, t), [query, t]);
  const registryCommands = useAssistantCommandMatches(sourceTitle, query);
  const empty = slashCommands.length === 0 && registryCommands.length === 0 && !actionsMatch?.(query);

  useAssistantMenuDismissal(true, containerRef, anchorRef, onClose);

  useLayoutEffect(() => {
    const element = containerRef.current;
    const panel = element?.parentElement;
    if (!element || !panel) return;
    const measure = () => {
      const siblings = Array.from(panel.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== element && !child.hasAttribute('data-assistant-messages'));
      const reserved = siblings.reduce((sum, child) => sum + child.offsetHeight, 0);
      element.style.maxHeight = `${Math.max(48, Math.min(panel.clientHeight * 0.6, panel.clientHeight - reserved - 8))}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    for (const child of Array.from(panel.children)) if (child instanceof HTMLElement && child !== element && !child.hasAttribute('data-assistant-messages')) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, []);

  // The menu is an in-flow sibling of the conversation: it shrinks the
  // conversation instead of overlaying it, so it can never be clipped by the
  // sheet and inherits the sheet's keyboard sizing for free.
  const dismiss = () => { onClose(); anchorRef.current?.focus(); };

  return <div
    ref={containerRef}
    role="dialog"
    aria-modal="false"
    aria-label={t("assistant.composer.menuTitle")}
    tabIndex={-1}
    data-assistant-composer-menu
    className="mx-2 mb-2 flex max-h-[60%] min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-container-high"
  >
    <label className="flex min-h-[48px] shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <MagnifyingGlass size={18} aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("assistant.composer.searchPlaceholder")}
        aria-label={t("assistant.composer.searchPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none"
      />
    </label>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
      {startAtActions && actions?.(query)}
      <button type="button" className={ROW_CLASS} onClick={() => { onAttach(); dismiss(); }}>
        <Images size={20} aria-hidden="true" />
        <span className="text-sm font-medium">{t("assistant.composer.attachImage")}</span>
      </button>
      {!startAtActions && actions?.(query)}
      {slashCommands.length > 0 && <>
        <p className={SECTION_CLASS}>{t("assistant.composer.slashCommands")}</p>
        {slashCommands.map((command) => <button key={command.command} type="button" className={ROW_CLASS} onClick={() => { onInsert(command.command); dismiss(); }}>
          <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-sm text-primary">/</span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-sm">{command.command}</span>
            <span className="block text-xs text-muted-foreground">{t(command.descriptionKey)}</span>
          </span>
        </button>)}
      </>}
      {registryCommands.length > 0 && <>
        <p id="mobile-composer-all-commands" className={SECTION_CLASS}>{t("assistant.composer.allCommands")}</p>
        <MobileAssistantCommands commands={registryCommands} onExecuted={dismiss} labelledBy="mobile-composer-all-commands" />
      </>}
      {empty && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">{t("assistant.composer.noResults")}</p>}
      <div className="mt-1 border-t border-border/60 pt-1">
        <button type="button" className={ROW_CLASS} onClick={() => { onNewConversation(); dismiss(); }}>
          <ChatCircleDots size={20} aria-hidden="true" />
          <span className="text-sm font-medium">{t("assistant.composer.newConversation")}</span>
        </button>
        {onShare && <button type="button" className={ROW_CLASS} onClick={() => { onShare(); dismiss(); }}>
          <ShareNetwork size={20} aria-hidden="true" />
          <span className="text-sm font-medium">{t("assistant.shareConversation")}</span>
        </button>}
      </div>
    </div>
    {!actions && <p className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">{t("assistant.composer.slashHint")}</p>}
  </div>;
}

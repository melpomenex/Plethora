/**
 * useRssSelectionMenu — text-selection right-click menu for RSS article
 * reading surfaces (reader pane, StoryView, RSSFullContentView).
 *
 * Offers the same selection actions as document viewing (Queue, EPUB, …):
 * the item set, order, and gating derive from the shared
 * selection-action registry's "menu" surface instead of being re-enumerated
 * here. Document-backed actions (extract, highlight, flashcard, Learn-this)
 * lazily ensure a backing library document for the article via
 * ensureRssArticleDocument — the same find-or-create pattern RSSScrollMode
 * uses — so no duplicates accumulate across selections.
 *
 * Host wiring (content container owns text selection):
 *   const selection = useRssSelectionMenu(feed, item);
 *   <div ref={selection.contentRef} onContextMenu={selection.handleContextMenu}>…</div>
 *   {selection.overlays}
 *
 * Right-click with no selection inside the container returns false so the
 * native menu (links, images) keeps precedence. Mobile long-press is
 * deliberately NOT bound here: it would fight text-selection gestures;
 * the shared ContextMenu still sheet-renders if ever triggered.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Feed, FeedItem } from "../../api/rss";
import type { Extract } from "../../api/extracts";
import {
  ContextMenu,
  ContextMenuItemType,
  type ContextMenuItem,
} from "../common/ContextMenu";
import { useSurfaceMenu } from "../../hooks/useSurfaceMenu";
import { shouldYieldRowMenu } from "../../lib/contextMenus";
import { useToastExtract } from "../../hooks/useToastExtract";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../common/Toast";
import {
  getSelectionActions,
  isAiSelectionAction,
  selectionActionLabelKey,
  type SelectionActionDescriptor,
  type SelectionAiAction,
  type SelectionActionId,
} from "../viewer/selectionInteraction/selectionActionRegistry";
import { recordSelectionActionInvocation } from "../viewer/selectionInteraction/selectionActionUsage";
import {
  SelectionActionsSheet,
  passageAroundSelection,
} from "../viewer/SelectionActionsSheet";
import {
  DictionaryPeek,
  type DictionaryPeekTarget,
} from "../viewer/selectionInteraction/DictionaryPeek";
import { CreateExtractDialog } from "../extracts/CreateExtractDialog";
import { FlashcardStudioModal } from "../review/FlashcardStudioModal";
import { LearnThisProposalSheet } from "../learn/LearnThisProposalSheet";
import { ensureRssArticleDocument } from "./rssArticleDocument";

const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

interface CapturedSelection {
  text: string;
  passage: string;
}

export function useRssSelectionMenu(
  feed: Feed | null | undefined,
  item: FeedItem | null | undefined,
) {
  const { t } = useI18n();
  const toast = useToast();
  const menu = useSurfaceMenu("rss-selection-menu");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { createInstantExtract } = useToastExtract();
  const aiAvailability = useAiAvailability("prompt");
  const learnThisEnabled = useSettingsStore((s) => s.settings.features.aiLearnThis);
  const documents = useDocumentStore((s) => s.documents);
  const addDocument = useDocumentStore((s) => s.addDocument);
  const updateDocument = useDocumentStore((s) => s.updateDocument);

  // Backing document id per article, so one article maps to one document.
  const backingDocIds = useRef(new Map<string, string>());
  // Selection snapshot taken at menu-open: native selection may collapse
  // while sheets/modals are open, so handlers use this, never live state.
  const pendingRef = useRef<CapturedSelection | null>(null);

  const [aiRequest, setAiRequest] = useState<{
    action: SelectionAiAction;
    text: string;
    passage: string;
  } | null>(null);
  const [dictTarget, setDictTarget] = useState<DictionaryPeekTarget | null>(null);
  const [dictDocId, setDictDocId] = useState<string | null>(null);
  const [extractDialog, setExtractDialog] = useState<{
    docId: string;
    text: string;
  } | null>(null);
  const [flashSeed, setFlashSeed] = useState<{
    key: string;
    documentId?: string | null;
    excerpt?: string;
    draftCardType: "qa";
    resetDraftCards: boolean;
    autoEditDraft: boolean;
  } | null>(null);
  const [learnRequest, setLearnRequest] = useState<{
    text: string;
    passage: string;
    docId?: string;
  } | null>(null);

  const deps = useMemo(
    () => ({ documents, addDocument, updateDocument }),
    [documents, addDocument, updateDocument],
  );

  const clearNativeSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
  }, []);

  const ensureDoc = useCallback(async (): Promise<string | null> => {
    if (!item) return null;
    const cached = backingDocIds.current.get(item.id);
    if (cached) return cached;
    try {
      const docId = await ensureRssArticleDocument(feed, item, deps);
      backingDocIds.current.set(item.id, docId);
      return docId;
    } catch (error) {
      toast.error(
        "Failed to prepare article",
        error instanceof Error ? error.message : undefined,
      );
      return null;
    }
  }, [feed, item, deps, toast]);

  const createExtractFor = useCallback(
    async (text: string, color?: string): Promise<Extract | null> => {
      const docId = await ensureDoc();
      if (!docId) return null;
      const extract = await createInstantExtract({ documentId: docId, text, color });
      if (extract) {
        pendingRef.current = null;
        clearNativeSelection();
      }
      return extract;
    },
    [ensureDoc, createInstantExtract, clearNativeSelection],
  );

  const readSelection = useCallback((): CapturedSelection | null => {
    const container = contentRef.current;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !container) return null;
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const inside =
      (anchorNode && container.contains(anchorNode)) ||
      (focusNode && container.contains(focusNode));
    if (!inside) return null;
    return { text, passage: passageAroundSelection(selection, text) };
  }, []);

  const openSheetForAi = useCallback((action: SelectionAiAction, sel: CapturedSelection) => {
    recordSelectionActionInvocation(action);
    setAiRequest({ action, text: sel.text, passage: sel.passage });
  }, []);

  const buildItems = useCallback(
    (sel: CapturedSelection): ContextMenuItem[] => {
      const builders: Partial<
        Record<SelectionActionId, (action: SelectionActionDescriptor) => ContextMenuItem>
      > = {
        extract: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("extract");
            void createExtractFor(sel.text);
          },
        }),
        extractDialog: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("extractDialog");
            void (async () => {
              const docId = await ensureDoc();
              if (docId) setExtractDialog({ docId, text: sel.text });
            })();
          },
        }),
        highlight: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          type: ContextMenuItemType.Submenu,
          children: HIGHLIGHT_COLORS.map((color) => ({
            id: `highlight-${color}`,
            label: t(`viewer.${color}Highlight`),
            onClick: () => {
              recordSelectionActionInvocation("highlight");
              void createExtractFor(sel.text, color);
            },
          })),
        }),
        copy: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          shortcut: "Ctrl+C",
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("copy");
            void navigator.clipboard?.writeText(sel.text);
          },
        }),
        dictionary: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("dictionary");
            const cached = item ? backingDocIds.current.get(item.id) ?? null : null;
            setDictDocId(cached);
            setDictTarget({ text: sel.text, passage: sel.passage, geometry: null });
          },
        }),
        flashcard: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("flashcard");
            void (async () => {
              const docId = await ensureDoc();
              if (!docId) return;
              setFlashSeed({
                key: `rss-${item?.id ?? "article"}-${Date.now()}`,
                documentId: docId,
                excerpt: sel.text,
                draftCardType: "qa",
                resetDraftCards: true,
                autoEditDraft: true,
              });
            })();
          },
        }),
        learnThis: (action) => ({
          id: action.id,
          label: t(selectionActionLabelKey(action, "menu")),
          icon: <action.icon className="w-4 h-4" />,
          onClick: () => {
            recordSelectionActionInvocation("learnThis");
            void (async () => {
              const docId = await ensureDoc();
              if (!docId) return;
              setLearnRequest({ text: sel.text, passage: sel.passage, docId });
            })();
          },
        }),
      };
      const buildAiItem = (action: SelectionActionDescriptor): ContextMenuItem => ({
        id: `ai-${action.id}`,
        label: t(selectionActionLabelKey(action, "menu")),
        icon: <action.icon className="w-4 h-4" />,
        onClick: () => openSheetForAi(action.id as SelectionAiAction, sel),
      });

      const actions = getSelectionActions("menu", {
        aiAvailable: aiAvailability.available,
        learnThisEnabled,
      });
      const items: ContextMenuItem[] = [];
      let lastGroup = -1;
      for (const action of actions) {
        if (lastGroup !== -1 && action.menuGroup !== lastGroup) {
          items.push({ id: `sep-${action.menuGroup}`, label: "", type: ContextMenuItemType.Separator });
        }
        lastGroup = action.menuGroup ?? 0;
        const build = builders[action.id];
        if (build) {
          items.push(build(action));
        } else if (isAiSelectionAction(action)) {
          items.push(buildAiItem(action));
        } else if (import.meta.env.DEV) {
          console.warn(`[useRssSelectionMenu] No builder for selection action "${action.id}"`);
        }
      }
      return items;
    },
    [t, aiAvailability.available, learnThisEnabled, createExtractFor, ensureDoc, openSheetForAi, item],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent): boolean => {
      if (!item) return false;
      if (shouldYieldRowMenu(e.target)) return false;
      const sel = readSelection();
      if (!sel) return false;
      pendingRef.current = sel;
      return menu.openEvent(e, buildItems(sel));
    },
    [item, readSelection, menu, buildItems],
  );

  const sheetExtract = useCallback(
    (text: string) => createExtractFor(text),
    [createExtractFor],
  );

  const peekExtract = useCallback(
    (text: string) => {
      void createExtractFor(text);
    },
    [createExtractFor],
  );

  const overlays = item ? (
    <>
      <ContextMenu
        menuId="rss-selection-menu"
        items={menu.items}
        visible={menu.visible}
        position={menu.position}
        onClose={menu.closeToTrigger}
      />
      {aiRequest && (
        <SelectionActionsSheet
          open
          text={aiRequest.text}
          passage={aiRequest.passage}
          initialAction={aiRequest.action}
          onClose={() => setAiRequest(null)}
          onCreateExtract={sheetExtract}
          onCreateExtractFromResult={sheetExtract}
          learnThis={{
            documentId: item ? backingDocIds.current.get(item.id) : undefined,
            documentTitle: item.title,
          }}
        />
      )}
      {dictTarget && (
        <DictionaryPeek
          target={dictTarget}
          documentId={dictDocId}
          onDismiss={() => {
            setDictTarget(null);
            setDictDocId(null);
          }}
          onCreateExtract={peekExtract}
          aiAvailable={aiAvailability.available}
        />
      )}
      {extractDialog && (
        <CreateExtractDialog
          documentId={extractDialog.docId}
          selectedText={extractDialog.text}
          isOpen
          onClose={() => {
            setExtractDialog(null);
            clearNativeSelection();
          }}
          onCreate={() => {
            setExtractDialog(null);
            clearNativeSelection();
          }}
        />
      )}
      <FlashcardStudioModal
        isOpen={!!flashSeed}
        onClose={() => setFlashSeed(null)}
        seed={flashSeed}
      />
      <LearnThisProposalSheet
        open={!!learnRequest}
        text={learnRequest?.text ?? ""}
        passage={learnRequest?.passage ?? ""}
        documentId={learnRequest?.docId}
        documentTitle={item.title}
        onClose={() => setLearnRequest(null)}
      />
    </>
  ) : null;

  return { contentRef, handleContextMenu, overlays };
}

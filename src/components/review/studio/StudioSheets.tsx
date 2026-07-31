/**
 * StudioSheets — the mobile bottom sheets behind the Studio's context chip bar.
 *
 * Each chip in `StudioContextChipBar` opens one of these. Every sheet body is
 * the same control the desktop layout renders inline, so mobile loses no
 * configuration option — only the always-visible real estate it used to occupy.
 *
 * Presentation, dismissal, scroll-locking and safe-area handling all come from
 * the shared `MobileContextMenuSheet`. These use its `content` variant: the
 * `menu` variant strips button borders/backgrounds (right for menu rows, wrong
 * for the pickers and primary actions rendered here).
 */

import {
  BookOpen,
  ChatCircle,
  CircleNotch,
  ClockCounterClockwise,
  Images,
  Lightning,
  Sparkle,
  TextT,
} from "@phosphor-icons/react";
import type { ImageAsset } from "../../../api/image-registry";
import { MobileContextMenuSheet } from "../../common/MobileContextMenuSheet";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";
import type { SectionNode } from "../../../utils/sectionIndex";
import { ContextControlPanel } from "./ContextControlPanel";
import { DeckSheetList } from "./DeckSelector";
import { DocumentSheetList } from "./DocumentSelector";
import type { ContextSelection } from "./contextSelection";
import type { StudioSheet } from "./studioChips";

type StudioViewMode = "chat" | "templates" | "history" | "sessions" | "extracts";

export interface StudioSheetsProps {
  activeSheet: StudioSheet | null;
  onClose: () => void;

  // Document
  documents: { id: string; title: string; content?: string }[];
  selectedDocumentId: string | null;
  onSelectDocument: (id: string | null) => void;

  // Deck
  decks: { id: string; name: string; tagFilters: string[] }[];
  selectedDeckId: string | null;
  suggestedDeckName?: string;
  onSelectDeck: (id: string | null) => void;
  onCreateDeck: (name: string) => string | null;

  // Images
  imageAssets: ImageAsset[];
  selectedImageAssetIds: string[];
  onToggleImageAsset: (id: string) => void;
  onOpenImageLibrary: () => void;
  onGenerateImageOcclusions: () => void;
  isImageImporting: boolean;
  isSending: boolean;
  canUseVisionOcclusion: boolean;

  // Context control
  selectedDocument: { id: string; title: string } | null;
  selectedDocumentText: string;
  contextSelection: ContextSelection;
  onContextSelectionChange: (selection: ContextSelection) => void;
  maxTokens: number;
  selectedSectionNodes: SectionNode[];
  focusedSectionTokens: number;
  onRemoveSection: (id: string) => void;

  // Views
  viewMode: StudioViewMode;
  onSelectViewMode: (mode: StudioViewMode) => void;
  sessionCount: number;
  extractCount: number;

  // Provider
  providers: { id: string; name: string }[];
  selectedProviderId: string | null;
  onSelectProvider: (id: string | null) => void;
  notebookLmAvailable: boolean;
  notebookLmProviderId: string;
  isNotebookProviderSelected: boolean;
  isNotebookLoading: boolean;
  notebooks: { id: string; title: string }[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
}

const rowClass =
  "w-full px-4 py-3 text-left text-[15px] min-h-[48px] flex items-center gap-3 transition-colors";

export function StudioSheets(props: StudioSheetsProps) {
  const { t } = useI18n();
  const { activeSheet, onClose } = props;

  if (!activeSheet) return null;

  const sheet = (title: string, body: React.ReactNode) => (
    <MobileContextMenuSheet open onClose={onClose} title={title} variant="content">
      {body}
    </MobileContextMenuSheet>
  );

  if (activeSheet === "document") {
    return sheet(
      t("flashcardStudio.sheetDocumentTitle"),
      <DocumentSheetList
        documents={props.documents}
        selectedId={props.selectedDocumentId}
        onSelect={(id) => {
          props.onSelectDocument(id);
          onClose();
        }}
      />
    );
  }

  if (activeSheet === "deck") {
    return sheet(
      t("flashcardStudio.sheetDeckTitle"),
      <DeckSheetList
        decks={props.decks}
        selectedId={props.selectedDeckId}
        suggestedName={props.suggestedDeckName}
        onSelect={(id) => {
          props.onSelectDeck(id);
          onClose();
        }}
        onCreateDeck={props.onCreateDeck}
      />
    );
  }

  if (activeSheet === "images") {
    const noneSelected = props.selectedImageAssetIds.length === 0;
    const occlusionDisabled =
      props.isImageImporting || props.isSending || noneSelected || !props.canUseVisionOcclusion;

    return sheet(
      t("flashcardStudio.sheetImagesTitle"),
      <div className="px-4 pb-2">
        {props.imageAssets.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-2 pb-3">
              {props.imageAssets.slice(0, 16).map((asset) => {
                const selected = props.selectedImageAssetIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => props.onToggleImageAsset(asset.id)}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border transition-all",
                      selected ? "border-primary ring-2 ring-primary/30" : "border-border"
                    )}
                    title={asset.file_name || asset.id}
                  >
                    <img
                      src={asset.data_url}
                      alt={asset.file_name || "Registry image"}
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
            <p className="pb-3 text-xs text-muted-foreground">
              {t("flashcardStudio.selectedCount", { count: props.selectedImageAssetIds.length })}
              {" · "}
              {t("flashcardStudio.imagePasteHint")}
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            props.onGenerateImageOcclusions();
            onClose();
          }}
          disabled={occlusionDisabled}
          title={
            noneSelected
              ? t("flashcardStudio.noImageSelectedDesc")
              : !props.canUseVisionOcclusion
              ? t("flashcardStudio.imageOcclusionVisionUnsupportedDesc")
              : t("flashcardStudio.generateImageOcclusions")
          }
          className="mb-2 flex w-full min-h-[48px] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-[15px] text-foreground disabled:opacity-50"
        >
          {props.isSending ? (
            <CircleNotch className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkle className="h-4 w-4" />
          )}
          {t("flashcardStudio.generateImageOcclusions")}
        </button>
        {occlusionDisabled && (
          <p className="mb-2 -mt-1 px-1 text-xs text-muted-foreground">
            {noneSelected
              ? t("flashcardStudio.noImageSelectedDesc")
              : !props.canUseVisionOcclusion
              ? t("flashcardStudio.imageOcclusionVisionUnsupportedDesc")
              : ""}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            props.onOpenImageLibrary();
            onClose();
          }}
          disabled={props.isImageImporting}
          className="flex w-full min-h-[48px] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-[15px] text-foreground disabled:opacity-60"
        >
          <Images className="h-4 w-4" />
          {t("flashcardStudio.openImageLibrary")}
        </button>
      </div>
    );
  }

  if (activeSheet === "context") {
    return sheet(
      t("flashcardStudio.contextControlTitle"),
      <div className="px-4 pb-2">
        {props.selectedDocument ? (
          <ContextControlPanel
            document={{
              id: props.selectedDocument.id,
              title: props.selectedDocument.title,
              content: props.selectedDocumentText,
            }}
            selection={props.contextSelection}
            onChange={props.onContextSelectionChange}
            maxTokens={props.maxTokens}
            selectedSections={props.selectedSectionNodes}
            focusedSectionTokens={props.focusedSectionTokens}
            onRemoveSection={props.onRemoveSection}
          />
        ) : (
          <ContextControlPanel
            document={null}
            selection={props.contextSelection}
            onChange={props.onContextSelectionChange}
            maxTokens={props.maxTokens}
          />
        )}
      </div>
    );
  }

  if (activeSheet === "views") {
    const views: Array<{
      mode: StudioViewMode;
      label: string;
      icon: React.ReactNode;
      count?: number;
    }> = [
      { mode: "chat", label: t("flashcardStudio.chat"), icon: <ChatCircle className="h-4 w-4" /> },
      { mode: "templates", label: t("flashcardStudio.templates"), icon: <Lightning className="h-4 w-4" /> },
      {
        mode: "sessions",
        label: t("flashcardStudio.sessions"),
        icon: <ClockCounterClockwise className="h-4 w-4" />,
        count: props.sessionCount,
      },
      {
        mode: "extracts",
        label: t("flashcardStudio.extracts"),
        icon: <TextT className="h-4 w-4" />,
        count: props.extractCount,
      },
    ];

    return sheet(
      t("flashcardStudio.sheetViewsTitle"),
      <div>
        {views.map((view) => (
          <button
            key={view.mode}
            type="button"
            onClick={() => {
              props.onSelectViewMode(view.mode);
              onClose();
            }}
            className={cn(
              rowClass,
              props.viewMode === view.mode ? "bg-primary/10 text-primary" : "active:bg-muted"
            )}
          >
            {view.icon}
            <span className="flex-1">{view.label}</span>
            {view.count !== undefined && view.count > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {view.count}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  // Provider — NotebookLM needs a notebook chosen too, so that selection is a
  // dependent step in this same sheet rather than a chip of its own.
  return sheet(
    t("flashcardStudio.sheetProviderTitle"),
    <div>
      {props.providers.length === 0 && !props.notebookLmAvailable && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t("flashcardStudio.noProvider")}
        </p>
      )}
      {props.notebookLmAvailable && (
        <button
          type="button"
          onClick={() => props.onSelectProvider(props.notebookLmProviderId)}
          className={cn(
            rowClass,
            props.selectedProviderId === props.notebookLmProviderId
              ? "bg-primary/10 text-primary"
              : "active:bg-muted"
          )}
        >
          <BookOpen className="h-4 w-4" />
          NotebookLM
        </button>
      )}
      {props.providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => {
            props.onSelectProvider(provider.id);
            onClose();
          }}
          className={cn(
            rowClass,
            props.selectedProviderId === provider.id ? "bg-primary/10 text-primary" : "active:bg-muted"
          )}
        >
          <Sparkle className="h-4 w-4 opacity-60" />
          {provider.name}
        </button>
      ))}

      {props.isNotebookProviderSelected && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center gap-2 px-4 pb-1 text-xs font-medium text-muted-foreground">
            {props.isNotebookLoading ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" />
            )}
            {t("flashcardStudio.selectNotebook")}
          </div>
          {props.notebooks.map((notebook) => (
            <button
              key={notebook.id}
              type="button"
              onClick={() => {
                props.onSelectNotebook(notebook.id);
                onClose();
              }}
              className={cn(
                rowClass,
                props.selectedNotebookId === notebook.id
                  ? "bg-primary/10 text-primary"
                  : "active:bg-muted"
              )}
            >
              <span className="flex-1">{notebook.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

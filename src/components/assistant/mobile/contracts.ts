import type { AssistantContext } from "../AssistantPanel";
import type { RefObject } from "react";

export const MOBILE_ASSISTANT_CONVERSATION_KEY = "mobile:global";
export type AssistantDetent = "closed" | "partial" | "expanded";
export type AssistantGesturePhase = "contact" | "dragging" | "rejected" | "ended";

/** A view must publish its own identity; hidden panes cannot attach evidence. */
export interface MobileAssistantRegistration {
  ownerTabId: string;
  ownerPaneId: string;
  revision: string;
  context: AssistantContext;
  controlsVisible?: boolean;
  unavailableReason?: string;
  /** Queue owns its embedded reader's source. */
  priority?: number;
}

/**
 * Sheet-level controls the host owns (detent, close, source attach) that the
 * panel renders inside its single mobile chrome row.
 */
export interface MobileAssistantSheetControls {
  detent: AssistantDetent;
  hasPartial: boolean;
  onClose: () => void;
  onToggleDetent: () => void;
  source?: {
    title: string;
    removed: boolean;
    onToggle: () => void;
  };
  /** Host-owned initial focus target for `useDialogFocus`. */
  closeRef: RefObject<HTMLButtonElement | null>;
}

export interface MobileAssistantPresentation {
  visible: boolean;
  actionsSuppressed?: boolean;
  viewIdentity?: string;
  sheet?: MobileAssistantSheetControls;
}

export interface AssistantSourceProvenance {
  /** Library IDs only; ephemeral article IDs never enter database lookups. */
  documentIds: string[];
  sourceId?: string;
  sourceTitle?: string;
  localOnly?: boolean;
}

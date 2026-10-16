import type { AssistantContext } from "../AssistantPanel";

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

export interface MobileAssistantPresentation {
  visible: boolean;
  viewIdentity?: string;
}

export interface AssistantSourceProvenance {
  /** Library IDs only; ephemeral article IDs never enter database lookups. */
  documentIds: string[];
  sourceId?: string;
  sourceTitle?: string;
  localOnly?: boolean;
}

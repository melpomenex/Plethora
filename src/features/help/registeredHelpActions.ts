import { useTabsStore } from "../../stores/tabsStore";
import { useDocumentStore } from "../../stores/documentStore";
import { t } from "../../lib/i18n";
import type { DocumentActionId } from "../../commandPalette/contextualActions";
import { requestDestinationAction, startPaletteScrollSession } from "../../commandPalette/destinationActions";
import { executeCommand } from "../../commandPalette/executeCommand";
import { dispatchPaletteAction } from "../../commandPalette/paletteActionEvents";
/**
 * Allowlisted Safe Interactive UI Actions for Ask Plethora & Canonical Documentation.
 *
 * Generated answers and canonical documentation cards can ONLY reference
 * action IDs explicitly registered here. Arbitrary command execution is strictly forbidden.
 */

export interface RegisteredHelpAction {
  label: string;
  description: string;
  handler: () => void | Promise<void>;
}

const dispatchNavigation = (path: string) => {
  if (path.startsWith("/settings?")) {
    const section = new URLSearchParams(path.split("?")[1]).get("tab") ?? "general";
    return requestDestinationAction({ destination: "settings", action: "section", section: ({ "scroll-queue": "smart-queue", "hands-free": "tts", "sync": "cloud-storage" } as Record<string, string>)[section] ?? section });
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("navigate", { detail: path }));
  }
};

const dispatchCustomEvent = (name: string, detail?: unknown) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
};

function dispatchReaderAction(actionId: DocumentActionId): void {
  const state = useTabsStore.getState();
  const paneId = state.navigationPaneId ?? state.getTabPaneIds()[0];
  const pane = paneId ? state.findPaneById(paneId) : null;
  const tab = pane?.type === "tabs" ? state.tabs.find((entry) => entry.id === pane.activeTabId) : null;
  if (tab?.type !== "document-viewer") throw new Error(t("commandPalette.openReaderFirst"));
  const doc = useDocumentStore.getState().documents.find((entry) => entry.id === tab.data?.documentId);
  if (actionId === "doc.toggleReflow" && doc?.fileType !== "pdf") throw new Error(t("commandPalette.openPdfFirst"));
  dispatchPaletteAction("document-viewer", actionId);
}

export const REGISTERED_HELP_ACTIONS: Record<string, RegisteredHelpAction> = {
  "action.view.dashboard": {
    label: "Go to Dashboard",
    description: "Navigate to home dashboard",
    handler: () => dispatchNavigation("/dashboard"),
  },
  "action.view.queue": {
    label: "Open Reading Queue",
    description: "Navigate to Reading Queue view",
    handler: () => dispatchNavigation("/queue"),
  },
  "action.view.review": {
    label: "Start Card Review",
    description: "Begin spaced repetition flashcard review session",
    handler: () => dispatchNavigation("/review"),
  },
  "settings.appearance.eink": {
    label: "Open E-ink Settings",
    description: "Configure high-contrast monochrome mode and animation toggles",
    handler: () => dispatchNavigation("/settings?tab=appearance&panel=eink"),
  },
  "settings.appearance.themes": {
    label: "Open Theme Settings",
    description: "Browse 100+ themes, fonts, and display palettes",
    handler: () => dispatchNavigation("/settings?tab=appearance"),
  },
  "settings.learning.algorithm": {
    label: "Configure FSRS-7",
    description: "Adjust FSRS-7 retention targets, maximum intervals, and personalized parameters",
    handler: () => dispatchNavigation("/settings?tab=learning&focus=algorithm"),
  },
  "settings.tts.general": {
    label: "Open TTS Settings",
    description: "Configure TTS voice, speed, Pocket TTS / Sherpa-ONNX engines",
    handler: () => dispatchNavigation("/settings?tab=tts"),
  },
  "settings.tts.highlighting": {
    label: "Configure TTS Highlighting",
    description: "Toggle spoken word highlighting and auto-scroll",
    handler: () => dispatchNavigation("/settings?tab=tts"),
  },
  "settings.audio.hands_free": {
    label: "Open Hands-Free Audio Settings",
    description: "Configure headphone media key mapping and audio study intervals",
    handler: () => dispatchNavigation("/settings?tab=hands-free"),
  },
  "settings.sync.cloud": {
    label: "Open Sync Settings",
    description: "Configure end-to-end encrypted Yjs cloud sync and delta logs",
    handler: () => dispatchNavigation("/settings?tab=sync"),
  },
  "settings.privacy.billing": {
    label: "Open AI & Privacy Settings",
    description: "Review paid API billing consent, provider keys, and on-device models",
    handler: () => dispatchNavigation("/settings?tab=ai"),
  },
  "settings.queue.composition": {
    label: "Open Queue Composition",
    description: "Adjust composition sliders between documents, extracts, and cards",
    handler: () => dispatchNavigation("/settings?tab=scroll-queue"),
  },
  "action.reader.toggle_reflow": {
    label: "Toggle PDF Reflow",
    description: "Convert PDF layout to reflowable responsive text",
    handler: () => dispatchReaderAction("doc.toggleReflow"),
  },
  "action.reader.reflow_toggle": {
    label: "Toggle PDF Reflow",
    description: "Convert PDF layout to reflowable responsive text",
    handler: () => dispatchReaderAction("doc.toggleReflow"),
  },
  "action.reader.toggle_tts": {
    label: "Toggle Text-to-Speech",
    description: "Start or pause audio playback for current document",
    handler: () => dispatchReaderAction("doc.toggleTts"),
  },
  "action.reader.toggle_vim": {
    label: "Toggle Vim Reading Mode",
    description: "Enable or disable Vim keyboard navigation in reader",
    handler: () => dispatchReaderAction("doc.toggleVimMode"),
  },
  "action.queue.open": {
    label: "Open Reading Queue",
    description: "Navigate to Reading Queue view",
    handler: () => dispatchNavigation("/queue"),
  },
  "action.queue.scroll_session": {
    label: "Start Scroll Queue Session",
    description: "Launch continuous TikTok-style incremental reading scroll session",
    handler: startPaletteScrollSession,
  },
  "action.review.start": {
    label: "Start Card Review",
    description: "Begin spaced repetition flashcard review session",
    handler: () => dispatchNavigation("/review"),
  },
  "action.review.zen": {
    label: "Open Card Review",
    description: "Open the card review workspace",
    handler: () => dispatchNavigation("/review"),
  },
  "action.review.flashcard_studio": {
    label: "Open Flashcard Studio",
    description: "Create or edit Q/A, Cloze, and Image Occlusion cards",
    handler: () => requestDestinationAction({ destination: "review", action: "create-card" }),
  },
  "action.language.dictionary": {
    label: "Open Language Settings",
    description: "Configure language profiles and dictionary options",
    handler: () => dispatchNavigation("/settings?tab=language-learning"),
  },
  "action.media.podcasts": {
    label: "Open Podcasts",
    description: "Browse subscribed podcasts and Whisper transcripts",
    handler: () => dispatchNavigation("/podcast"),
  },
  "action.media.rss": {
    label: "Open RSS Reader",
    description: "Read full-text RSS feeds and NewsBlur subscriptions",
    handler: () => dispatchNavigation("/rss"),
  },
  "action.search.knowledge_sphere": {
    label: "Open 3D Knowledge Sphere",
    description: "Explore 3D semantic graph of library connections",
    handler: () => dispatchNavigation("/knowledge-sphere"),
  },
  "action.search.command_center": {
    label: "Open Command Palette",
    description: "Open unified global search and command center",
    handler: () => dispatchCustomEvent("command-palette-open"),
  },
};

export type RegisteredHelpActionId = keyof typeof REGISTERED_HELP_ACTIONS;

export function isRegisteredHelpActionId(id: string): id is RegisteredHelpActionId {
  return Object.prototype.hasOwnProperty.call(REGISTERED_HELP_ACTIONS, id);
}
export const isRegisteredHelpAction = isRegisteredHelpActionId;

export function executeHelpAction(actionId: string): boolean {
  if (isRegisteredHelpActionId(actionId)) {
    try {
      const action = REGISTERED_HELP_ACTIONS[actionId];
      void executeCommand({ id: actionId, label: action.label, action: action.handler });
      return true;
    } catch (error) {
      console.warn(`[registeredHelpActions] Failed to execute action ${actionId}:`, error);
      return false;
    }
  }
  console.warn(`[registeredHelpActions] Attempted to execute unallowlisted action: ${actionId}`);
  return false;
}
export const dispatchRegisteredHelpAction = executeHelpAction;

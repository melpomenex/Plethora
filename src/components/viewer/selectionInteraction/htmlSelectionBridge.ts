/**
 * HTML reader iframe → V2 selection controller bridge
 * (hyperlink-selection-context-actions task 2.4).
 *
 * Registers the html document's iframe with the selection controller so
 * selection activity inside it drives the machine — with a context builder
 * that captures the TextSelectionContext (and its durable quote anchor)
 * synchronously at settle, matching the EPUB bridge contract.
 *
 * Registration is LOAD-AWARE: a srcDoc navigation replaces the iframe's
 * Document after mount, taking any listeners with it. Registering only once
 * at mount leaves the bridge attached to the dead pre-navigation document —
 * on touch devices the machine then never sees the selection and only the
 * native system pill (Copy/Share/Select All) appears instead of Plethora's
 * action bar. EPUB solves the same problem by re-registering on every spine
 * item load (rendition content hook); this helper re-attaches on every
 * iframe load event.
 */

import type { ContentDocumentEntry } from "./adapters";
import { buildTextSelectionContext } from "../../../utils/textHighlights";

export interface HtmlSelectionBridgeController {
  registerContentDocument: (entry: ContentDocumentEntry) => () => void;
}

export function attachHtmlSelectionBridge(params: {
  frame: HTMLIFrameElement;
  controller: HtmlSelectionBridgeController;
  documentId: string;
}): () => void {
  const { frame, controller, documentId } = params;
  let detach: (() => void) | null = null;

  const attach = () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    detach?.();
    detach = controller.registerContentDocument({
      doc,
      win,
      offset: () => {
        try {
          const rect = frame.getBoundingClientRect();
          return { x: rect.left, y: rect.top };
        } catch {
          return null;
        }
      },
      buildSelectionContext: (range: Range) => {
        const body = doc.body;
        if (!body) return null;
        try {
          return buildTextSelectionContext({
            root: body,
            range,
            documentId,
            surface: "html",
          });
        } catch {
          // Cross-document range issues fall back to the legacy listener path.
          return null;
        }
      },
    });
  };

  // Cover both orders: a frame that is already complete (effect re-running on
  // prop change) and the normal srcDoc path that finishes loading later.
  try {
    if (frame.contentDocument?.readyState === "complete") attach();
  } catch {
    // Cross-origin access — the load listener is the only path then.
  }
  frame.addEventListener("load", attach);
  return () => {
    frame.removeEventListener("load", attach);
    detach?.();
  };
}

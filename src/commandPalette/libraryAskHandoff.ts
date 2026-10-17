/**
 * Typed, acknowledged palette → Document Q&A entry. Never submits a turn.
 *
 * Extended for unify-assistant-experience (task 5.2): a handoff may carry a
 * canonical `conversationId` to open an existing thread, typed source
 * attachments (e.g. Compare these documents), an explicit restriction and a
 * selection snapshot, plus an origin return record. Exactly-once delivery is
 * preserved: delayed mounts and duplicate activations consume one nonce.
 */
import { create } from "zustand";
import type {
  ContextPolicy,
  SelectionSnapshot,
  SourceReference,
} from "../lib/ai/assistant/conversations/types";

export interface LibraryAskHandoff {
  nonce: number;
  intent: "open" | "prefill";
  question: string;
  contextPassage?: string;
  documentId?: string;
  /** Existing canonical conversation to open (never creates a new one). */
  conversationId?: string;
  /** Typed source attachments for the prepared turn. */
  sourceAttachments?: SourceReference[];
  /** Explicit restriction prepared by the entry. */
  restriction?: ContextPolicy;
  /** Selection captured by the entry (exact passage + locator). */
  selectionSnapshot?: SelectionSnapshot;
  /** Where the user will return when they dismiss the workspace. */
  origin?: { surface: string; conversationId?: string; documentId?: string };
}

type QuestionHandoff = Omit<LibraryAskHandoff, "nonce" | "intent">;

interface LibraryAskHandoffState {
  pending: LibraryAskHandoff | null;
  requestOpen: () => void;
  requestAsk: (handoff: QuestionHandoff) => void;
  /** Open (or target) an existing conversation without a question. */
  requestConversation: (conversationId: string, origin?: LibraryAskHandoff["origin"]) => void;
  /** With an id, acknowledges only that request; without one, dismisses. */
  consumeAsk: (nonce?: number) => void;
}

let nonceCounter = 0;
export const useLibraryAskHandoffStore = create<LibraryAskHandoffState>((set) => ({
  pending: null,
  requestOpen: () => set((state) => state.pending?.intent === "open" ? state : {
    pending: { nonce: ++nonceCounter, intent: "open", question: "" },
  }),
  requestAsk: (handoff) => set({
    pending: { ...handoff, nonce: ++nonceCounter, intent: "prefill" },
  }),
  requestConversation: (conversationId, origin) => set({
    pending: { nonce: ++nonceCounter, intent: "open", question: "", conversationId, origin },
  }),
  consumeAsk: (nonce) => set((state) =>
    nonce === undefined || state.pending?.nonce === nonce ? { pending: null } : state),
}));

/**
 * The canonical entry intent for a paletted request. `intentId` mirrors the
 * nonce so exactly-once acknowledgment holds end to end.
 */
export function handoffToEntryIntent(handoff: LibraryAskHandoff): {
  intentId: string;
  kind: "open" | "prefill";
  conversationId?: string;
  question?: string;
  sourceAttachments?: SourceReference[];
  restriction?: ContextPolicy;
  selectionSnapshot?: SelectionSnapshot;
  origin?: { surface: string; conversationId?: string };
} {
  return {
    intentId: `palette-${handoff.nonce}`,
    kind: handoff.intent,
    conversationId: handoff.conversationId,
    question: handoff.intent === "prefill" ? handoff.question : undefined,
    sourceAttachments: handoff.sourceAttachments,
    restriction: handoff.restriction,
    selectionSnapshot: handoff.selectionSnapshot,
    origin: handoff.origin,
  };
}

/**
 * Compare-these-documents handoff: both real ids and an editable question,
 * with no other source silently substituted.
 */
export function buildCompareDocumentsHandoff(options: {
  documents: Array<{ id: string; title: string }>;
  question?: string;
}): QuestionHandoff {
  return {
    question:
      options.question ??
      `Compare ${options.documents.map((document) => document.title).join(" and ")}.`,
    sourceAttachments: options.documents.map((document) => ({
      attachmentId: `att-compare-${document.id}`,
      kind: "document" as const,
      libraryId: document.id,
      title: document.title,
      origin: "picker" as const,
      role: "required" as const,
    })),
    restriction: {
      mode: "library",
      origin: "entry",
      allowedDocumentIds: options.documents.map((document) => document.id),
    },
    origin: { surface: "palette-compare" },
  };
}

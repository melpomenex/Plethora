import { useVimModeStore } from "../../stores/vimModeStore";
import type { VimActionContext } from "./actions";
import type { DocumentVimAdapter, DocumentVimMotion } from "./documentAdapter";
import { orderDocumentRange, type DocumentPosition, type VimActionSnapshot } from "./documentModel";
import { VimNavigationRequestCoordinator } from "./navigationRequest";
import { eventMatchesCombo, getShortcutCombo } from "../../components/common/KeyboardShortcuts";

type V2Action = "extract" | "extract-dialog" | "yank" | "highlight" | "flashcard" | "extract2card";

export class DocumentVimEngine {
  private readonly navigation = new VimNavigationRequestCoordinator();
  private caret: HTMLDivElement | null = null;
  private desiredX: number | null = null;
  private disposed = false;
  private readonly unsubscribeInvalidation: () => void;

  constructor(
    private readonly adapter: DocumentVimAdapter,
    private readonly actionContext: () => VimActionContext | undefined,
  ) {
    this.unsubscribeInvalidation = adapter.subscribeInvalidation((event) => {
      if (event.kind === "destroyed" || this.disposed) return;
      const store = useVimModeStore.getState();
      const position = store.cursorPosition;
      if (!position || store.activeDocId !== adapter.documentId) return;
      if (event.kind === "content") {
        void adapter.resolvePosition(position).then((resolved) => {
          if (resolved) useVimModeStore.getState().moveToPosition(resolved);
          void this.render();
        });
      } else {
        void this.render();
      }
    });
  }

  async activate(): Promise<boolean> {
    const capabilities = await this.adapter.capabilities();
    if (!capabilities.textNavigation) {
      useVimModeStore.getState().setFeedback({ kind: "unavailable", message: capabilities.reasonUnavailable ?? "No navigable text" });
      return false;
    }
    const position = await this.adapter.initialPosition();
    if (!position) return false;
    const store = useVimModeStore.getState();
    store.activate(this.adapter.documentId);
    store.moveToPosition(position);
    await this.adapter.reveal(position);
    await this.render();
    return true;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.disposed) return false;
    const store = useVimModeStore.getState();
    if (store.mode === "inactive") return false;
    if (event.key === "Escape") {
      if (store.colorPickerOpen) { store.setColorPickerOpen(false); return true; }
      if (store.pendingOperator || store.pendingSequence || store.countPrefix) {
        store.setPendingOperator(null); store.setPendingSequence(""); store.setCountPrefix(""); return true;
      }
      if (store.mode === "visual" || store.mode === "visual-line") {
        store.setSelectionRange(null); store.setMode("normal"); void this.adapter.renderRange(null); void this.render(); return true;
      }
      this.deactivate(); return true;
    }
    if (event.key === "?") { window.dispatchEvent(new CustomEvent("vim-reading-help")); return true; }
    if (/^[1-9]$/.test(event.key) || (store.countPrefix && event.key === "0")) {
      store.setCountPrefix(store.countPrefix + event.key); return true;
    }
    if (store.mode === "normal" && (event.key === "v" || event.key === "V")) {
      const position = store.cursorPosition;
      if (!position) return true;
      store.setMode(event.key === "V" ? "visual-line" : "visual");
      if (event.key === "V") {
        void this.adapter.lineRange(position).then((range) => { useVimModeStore.getState().setSelectionRange(range); void this.adapter.renderRange(range); });
      } else {
        store.setSelectionRange(orderDocumentRange(position, position));
        void this.adapter.renderRange(useVimModeStore.getState().selectionRange);
      }
      return true;
    }
    if (store.mode === "visual" || store.mode === "visual-line") {
      const action = actionForKey(event);
      if (action === "highlight") { store.setColorPickerOpen(true); return true; }
      if (action) { void this.performAction(action); return true; }
    }
    if (store.mode === "normal" && store.pendingOperator && event.key === store.pendingOperator) {
      const position = store.cursorPosition;
      if (position) void this.adapter.lineRange(position).then((range) => {
        const latest = useVimModeStore.getState(); latest.setSelectionRange(range); latest.setMode("visual");
        void this.adapter.renderRange(range);
        void this.performAction(store.pendingOperator === "y" ? "yank" : store.pendingOperator === "c" ? "extract-dialog" : "extract");
      });
      return true;
    }
    if (store.mode === "normal" && !store.pendingOperator && ["d", "c", "y"].includes(event.key)) {
      store.setPendingOperator(event.key as "d" | "c" | "y"); void this.render(); return true;
    }
    const motion = motionForKey(event, store.pendingSequence);
    if (event.key === "g" && !event.shiftKey && !motion) { store.setPendingSequence("g"); return true; }
    if (!motion) return false;
    store.setPendingSequence("");
    void this.move(motion);
    return true;
  }

  deactivate(): void {
    this.navigation.cancel();
    void this.adapter.renderRange(null);
    useVimModeStore.getState().deactivate();
    this.removeCaret();
  }

  async handlePointerUp(event: PointerEvent | MouseEvent): Promise<void> {
    const store = useVimModeStore.getState();
    if (store.mode === "inactive") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button,input,select,textarea,[role='button'],[data-reader-chrome]")) return;
    const ownerWindow = target?.ownerDocument.defaultView ?? window;
    const selection = ownerWindow.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const rects = Array.from(selection.getRangeAt(0).getClientRects());
      const first = rects[0]; const last = rects.at(-1);
      if (first && last) {
        const [anchor, head] = await Promise.all([
          this.adapter.positionFromPoint(first.left + 1, first.top + first.height / 2),
          this.adapter.positionFromPoint(last.right - 1, last.top + last.height / 2),
        ]);
        if (anchor && head) {
          const range = orderDocumentRange(anchor, head);
          store.moveToPosition(head); store.setMode("visual"); store.setSelectionRange(range);
          await this.adapter.renderRange(range); await this.render(); return;
        }
      }
    }
    const position = await this.adapter.positionFromPoint(event.clientX, event.clientY);
    if (position) { store.moveToPosition(position); store.setSelectionRange(null); store.setMode("normal"); await this.render(); }
  }

  performExternalAction(action: V2Action, color?: string): void { void this.performAction(action, color); }

  async move(motion: DocumentVimMotion): Promise<void> {
    const before = useVimModeStore.getState();
    const from = before.cursorPosition;
    if (!from) return;
    const count = Math.max(1, Number.parseInt(before.countPrefix || "1", 10));
    const operator = before.pendingOperator;
    before.setCountPrefix("");
    before.setResolving(true);
    void this.render();
    await this.navigation.run(
      async (signal) => {
        const moved = await this.adapter.move(from, { motion, count, desiredX: this.desiredX, signal });
        await this.adapter.reveal(moved.position, signal);
        return moved;
      },
      (moved) => {
        const destination = moved.position;
        const store = useVimModeStore.getState();
        store.moveToPosition(destination);
        const vertical = motion === "line-up" || motion === "line-down";
        this.desiredX = vertical ? moved.desiredX : null;
        if (vertical && moved.desiredX !== null) store.setDesiredColumn(moved.desiredX);
        if (store.mode === "visual" || store.mode === "visual-line") {
          const anchor = store.selectionRange?.anchor ?? from;
          if (store.mode === "visual-line") {
            void Promise.all([this.adapter.lineRange(anchor), this.adapter.lineRange(destination)]).then(([anchorLine, destinationLine]) => {
              const lineRange = orderDocumentRange(anchorLine.start, destinationLine.end);
              useVimModeStore.getState().setSelectionRange(lineRange); void this.adapter.renderRange(lineRange);
            });
          } else {
            store.setSelectionRange(orderDocumentRange(anchor, destination));
            void this.adapter.renderRange(useVimModeStore.getState().selectionRange);
          }
        } else if (operator) {
          store.setSelectionRange(orderDocumentRange(from, destination));
          store.setMode("visual");
          void this.adapter.renderRange(useVimModeStore.getState().selectionRange);
          void this.performAction(operator === "y" ? "yank" : operator === "c" ? "extract-dialog" : "extract");
        }
        store.setPendingOperator(null);
        store.setResolving(false);
        void this.render();
      },
    );
    useVimModeStore.getState().setResolving(false);
  }

  private async performAction(action: V2Action, color = "yellow"): Promise<void> {
    const store = useVimModeStore.getState();
    const range = store.selectionRange;
    const context = this.actionContext();
    if (!range || !context) return;
    try {
      const snapshot = await this.adapter.snapshot(range);
      await runSnapshotAction(action, snapshot, context, color);
      store.moveToPosition(range.start);
      store.setSelectionRange(null);
      store.setMode("normal");
      store.setFeedback({ kind: "success", message: actionFeedback(action) });
      store.setColorPickerOpen(false);
      await this.adapter.renderRange(null);
      await this.render();
    } catch (error) {
      store.setFeedback({ kind: "error", message: error instanceof Error ? `${error.message} — retry` : "Action failed — retry" });
    }
  }

  private async render(): Promise<void> {
    const position = useVimModeStore.getState().cursorPosition;
    if (!position) return;
    const geometry = await this.adapter.geometry(position);
    if (!geometry) return;
    useVimModeStore.getState().setLocationLabel(position.kind === "pdf" ? `p. ${position.pageNumber}` : `Chapter ${position.spineIndex + 1}`);
    const rect = geometry.rect;
    const caret = this.caret ?? this.createCaret();
    caret.style.left = `${rect.left}px`; caret.style.top = `${rect.top}px`;
    caret.style.width = `${Math.max(2, rect.width)}px`; caret.style.height = `${Math.max(16, rect.height)}px`;
    const state = useVimModeStore.getState();
    caret.className = ["vim-v2-caret", `vim-v2-caret--${state.mode}`, state.pendingOperator ? "is-operator" : "", state.isResolving ? "is-resolving" : ""].filter(Boolean).join(" ");
  }
  private createCaret(): HTMLDivElement {
    const caret = document.createElement("div");
    caret.setAttribute("aria-hidden", "true");
    document.body.appendChild(caret); this.caret = caret; return caret;
  }
  private removeCaret(): void { this.caret?.remove(); this.caret = null; }
  dispose(): void { this.disposed = true; this.unsubscribeInvalidation(); this.deactivate(); this.adapter.dispose(); }
}

function motionForKey(event: KeyboardEvent, pending: string): DocumentVimMotion | null {
  if (pending === "g" && event.key === "g") return "document-start";
  if (event.key === "G") return "document-end";
  return ({ h: "left", l: "right", w: "word-forward", e: "word-end", b: "word-backward", j: "line-down", k: "line-up", "0": "line-start", "$": "line-end", "{": "paragraph-backward", "}": "paragraph-forward" } as Record<string, DocumentVimMotion>)[event.key] ?? null;
}
function actionForKey(event: KeyboardEvent): V2Action | null {
  const actions: Array<[string, V2Action]> = [["vim.extract", "extract"], ["vim.extract-dialog", "extract-dialog"], ["vim.yank", "yank"], ["vim.highlight", "highlight"], ["vim.flashcard", "flashcard"]];
  return actions.find(([id]) => { const combo = getShortcutCombo(id); return combo ? eventMatchesCombo(event, combo) : false; })?.[1] ?? null;
}
async function runSnapshotAction(action: V2Action, snapshot: VimActionSnapshot, context: VimActionContext, color: string) {
  if (action === "yank") { await navigator.clipboard.writeText(snapshot.text); return; }
  if (action === "extract-dialog") { context.openExtractDialog(snapshot.text); return; }
  if (action === "flashcard") {
    context.openFlashcardStudio({ key: `vim-${snapshot.documentId}-${Date.now()}`, documentId: snapshot.documentId, excerpt: snapshot.text, draftCardType: useVimModeStore.getState().defaultVimCardType }); return;
  }
  const result = await context.createInstantExtract({ documentId: snapshot.documentId, text: snapshot.text, color: action === "highlight" ? color : undefined, pageNumber: snapshot.range.start.kind === "pdf" ? snapshot.range.start.pageNumber : context.getPageNumber(), selectionContext: snapshot.selectionContext });
  const id = (result as { id?: string } | null)?.id;
  if (id) context.setLastExtractId?.(id);
  if (action === "extract2card" && id) context.openFlashcardStudioForExtract?.({ key: `vim-chain-${snapshot.documentId}-${Date.now()}`, documentId: snapshot.documentId, extractId: id });
}
function actionFeedback(action: V2Action): string { return ({ extract: "Extracted", "extract-dialog": "Ready to edit", yank: "Copied", highlight: "Highlighted", flashcard: "Card started", extract2card: "Extracted · card started" })[action]; }

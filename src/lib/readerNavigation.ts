/** Viewport authority lasts until a new action, never until a timer expires. */
export type ReaderNavigationState = "initial-restoration" | "user-scroll" | "toc-navigation" | "idle";

export class ReaderNavigationOwner {
  state: ReaderNavigationState = "initial-restoration";
  private identity = 0;
  private initialAllowed = true;
  private controller = new AbortController();

  get ticket(): number { return this.identity; }
  get canRestore(): boolean { return this.initialAllowed; }
  get signal(): AbortSignal { return this.controller.signal; }

  private advance(): number {
    this.controller.abort();
    this.controller = new AbortController();
    return ++this.identity;
  }

  beginToc(): number {
    this.initialAllowed = false;
    this.state = "toc-navigation";
    return this.advance();
  }

  userScroll(): void {
    this.initialAllowed = false;
    this.state = "user-scroll";
    this.advance();
  }

  owns(ticket: number): boolean { return this.identity === ticket; }

  settle(ticket: number): boolean {
    if (!this.owns(ticket)) return false;
    this.initialAllowed = false;
    this.state = "idle";
    return true;
  }
}

/** Observe real input, including iframe input (which never bubbles to its host). */
export function observeReaderInput(target: EventTarget, interrupt: () => void): () => void {
  const options = { capture: true, passive: true };
  const keydown = (event: Event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes((event as KeyboardEvent).key)) interrupt();
  };
  const events = ["touchstart", "touchmove", "pointerdown", "wheel"];
  events.forEach((type) => target.addEventListener(type, interrupt, options));
  target.addEventListener("keydown", keydown, options);
  return () => {
    events.forEach((type) => target.removeEventListener(type, interrupt, options));
    target.removeEventListener("keydown", keydown, options);
  };
}

/** Cancel follow work on the same reader surface before async anchor lookup. */
export const READER_NAVIGATION_EVENT = "plethora-reader-navigation";
export function announceReaderNavigation(target: EventTarget | null): void {
  target?.dispatchEvent(new Event(READER_NAVIGATION_EVENT, { bubbles: true }));
}

export class VimRangeOverlay {
  private elements: HTMLElement[] = [];
  clear(): void { this.elements.forEach((element) => element.remove()); this.elements = []; }
  render(rects: readonly DOMRectReadOnly[], continuation: { before: boolean; after: boolean }): void {
    this.clear();
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const element = document.createElement("div");
      element.className = "vim-v2-range-overlay";
      Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      document.body.appendChild(element); this.elements.push(element);
    }
    if (continuation.before) this.addContinuation("before");
    if (continuation.after) this.addContinuation("after");
  }
  private addContinuation(edge: "before" | "after") {
    const element = document.createElement("div");
    element.className = `vim-v2-range-continuation is-${edge}`;
    element.textContent = edge === "before" ? "Selection continues above" : "Selection continues below";
    document.body.appendChild(element); this.elements.push(element);
  }
  dispose(): void { this.clear(); }
}

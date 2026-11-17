interface DecoratedRange {
  range: Range;
  start: boolean;
  end: boolean;
}

export const GUIDED_READING_HIGHLIGHT = {
  fill: 'rgba(249, 115, 22, 0.55)',
  outline: 'rgba(194, 65, 12, 0.45)',
} as const;

function rectsForRange(range: Range) {
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
}

export function readingRangeVisible(range: Range) {
  const start = range.startContainer.parentElement;
  const view = start?.ownerDocument.defaultView;
  if (!start || !view || view.getComputedStyle(start).visibility !== 'visible') return false;
  return typeof range.getClientRects === 'function' && rectsForRange(range).length > 0;
}

export function readingStartInViewport(range: Range) {
  if (!readingRangeVisible(range)) return false;
  const rect = rectsForRange(boundaryWord(range, true))[0];
  if (!rect) return false;
  let element: Element | null = range.startContainer.parentElement;
  let top = rect.top;
  let left = rect.left;
  while (element) {
    const win = element.ownerDocument.defaultView;
    if (!win) return false;
    if (top + rect.height <= 0 || top >= win.innerHeight || left + rect.width <= 0 || left >= win.innerWidth) return false;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/(scroll|auto|hidden|clip)/.test(style.overflowY) && (top >= bounds.bottom || top + rect.height <= bounds.top)) return false;
      if (/(scroll|auto|hidden|clip)/.test(style.overflowX) && (left >= bounds.right || left + rect.width <= bounds.left)) return false;
    }
    element = win.frameElement;
    if (element) {
      const bounds = element.getBoundingClientRect();
      top += bounds.top;
      left += bounds.left;
    }
  }
  return true;
}

export function revealReadingRange(range: Range) {
  const parent = range.startContainer.parentElement;
  const win = parent?.ownerDocument.defaultView;
  if (!parent || !win || !readingRangeVisible(range)) return false;
  const rect = rectsForRange(range)[0];
  let scroller = parent.parentElement;
  while (scroller && !/(auto|scroll)/.test(win.getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (scroller && scroller.clientHeight && scroller.scrollHeight > scroller.clientHeight) {
    const bounds = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - bounds.top - 36;
    if (rect.left < bounds.left || rect.left >= bounds.right) {
      scroller.scrollLeft += rect.left - bounds.left - 20;
    }
  } else {
    win.scrollBy({ top: rect.top - 36, behavior: 'instant' });
  }
  return readingStartInViewport(range);
}

/**
 * Paint through the browser's range highlight registry where available.
 * A geometry-only fallback covers WebViews without Custom Highlights and
 * transparent PDF text layers. Neither path restructures selectable text.
 */
export function paintReadingPassage(
  root: Element,
  items: DecoratedRange[],
  requestId: number,
  geometryOnly = false,
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win || !items.length) return () => {};
  const css = (win as Window & { CSS?: typeof CSS }).CSS;
  const Highlight = (win as Window & { Highlight?: new (...ranges: Range[]) => Highlight }).Highlight;
  const name = `study-passage-${requestId}`;
  const style = doc.createElement('style');
  const { fill, outline } = GUIDED_READING_HIGHLIGHT;
  if (!geometryOnly && css?.highlights && Highlight) {
    const starts: Range[] = [];
    const ends: Range[] = [];
    for (const { range, start, end } of items) {
      if (start) starts.push(boundaryWord(range, true));
      if (end) ends.push(boundaryWord(range, false));
    }
    style.textContent = `
      ::highlight(${name}) {
        background-color: ${fill};
        text-shadow: 0 0 1px ${outline};
      }
      ::highlight(${name}-start) { text-decoration: underline 2px ${outline}; }
      ::highlight(${name}-end) { text-decoration: underline double 2px ${outline}; }
    `;
    doc.head.appendChild(style);
    css.highlights.set(name, new Highlight(...items.map(({ range }) => range)));
    css.highlights.set(`${name}-start`, new Highlight(...starts));
    css.highlights.set(`${name}-end`, new Highlight(...ends));
    return () => {
      style.remove();
      css.highlights.delete(name);
      css.highlights.delete(`${name}-start`);
      css.highlights.delete(`${name}-end`);
    };
  }

  const layer = doc.createElement('div');
  layer.dataset.studyDecoration = '';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2';
  doc.body.appendChild(layer);
  let frame = 0;
  const draw = () => {
    frame = 0;
    const fragment = doc.createDocumentFragment();
    const bounds = root.getBoundingClientRect();
    const clip = { top: Math.max(0, bounds.top), bottom: Math.min(win.innerHeight, bounds.bottom) };
    function addRect(rect: DOMRect, boundary?: 'start' | 'end') {
      const top = Math.max(clip.top, rect.top);
      const bottom = Math.min(clip.bottom, rect.bottom);
      if (bottom <= top || rect.right <= 0 || rect.left >= win.innerWidth) return;
      const mark = doc.createElement('span');
      mark.style.cssText = `position:absolute;left:${rect.left}px;top:${top}px;width:${rect.width}px;height:${bottom - top}px;`;
      if (boundary) {
        mark.style.borderBottom = `2px ${boundary === 'end' ? 'double' : 'solid'} ${outline}`;
      } else {
        mark.style.background = fill;
        mark.style.borderRadius = '2px';
        mark.style.boxShadow = `inset 0 0 0 1px ${outline}`;
      }
      fragment.appendChild(mark);
    }
    if (root.isConnected) {
      for (const { range, start, end } of items) {
        for (const rect of rectsForRange(range)) addRect(rect);
        if (start) for (const rect of rectsForRange(boundaryWord(range, true))) addRect(rect, 'start');
        if (end) for (const rect of rectsForRange(boundaryWord(range, false))) addRect(rect, 'end');
      }
    }
    layer.replaceChildren(fragment);
  };
  const update = () => { if (!frame) frame = win.requestAnimationFrame(draw); };
  draw();
  win.addEventListener('scroll', update, { capture: true, passive: true });
  win.addEventListener('resize', update);
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
  observer?.observe(root);
  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener('scroll', update, true);
    win.removeEventListener('resize', update);
    observer?.disconnect();
    layer.remove();
  };
}

function boundaryWord(range: Range, start: boolean) {
  const result = range.cloneRange();
  if (start) {
    const text = range.startContainer.textContent ?? '';
    const end = range.startContainer === range.endContainer ? range.endOffset : text.length;
    const word = text.slice(range.startOffset, end).match(/^\S+/u)?.[0] ?? '';
    result.setEnd(range.startContainer, range.startOffset + word.length);
  } else {
    const text = range.endContainer.textContent ?? '';
    const startOffset = range.startContainer === range.endContainer ? range.startOffset : 0;
    const word = text.slice(startOffset, range.endOffset).match(/\S+$/u)?.[0] ?? '';
    result.setStart(range.endContainer, range.endOffset - word.length);
  }
  return result;
}

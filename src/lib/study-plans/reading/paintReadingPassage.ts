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
  const word = boundaryWord(range, true);
  const rect = (rectsForRange(word)[0] ?? rectsForRange(range)[0]);
  if (!rect) return false;
  let element: Element | null = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? (range.startContainer as Element)
    : range.startContainer.parentElement;
  let top = rect.top;
  let left = rect.left;
  while (element) {
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    if (!win) return false;
    if (top + rect.height <= 0 || top >= win.innerHeight || left + rect.width <= 0 || left >= win.innerWidth) return false;
    const insideFrame = Boolean(win.frameElement);
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      if (insideFrame && (parent === doc.body || parent === doc.documentElement)) continue;
      const style = win.getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const clipsY = /(hidden|clip)/.test(style.overflowY)
        || (/(scroll|auto|overlay)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 2);
      const clipsX = /(hidden|clip)/.test(style.overflowX)
        || (/(scroll|auto|overlay)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 2);
      if (clipsY && (top >= bounds.bottom || top + rect.height <= bounds.top)) return false;
      if (clipsX && (left >= bounds.right || left + rect.width <= bounds.left)) return false;
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
  const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? (range.startContainer as Element)
    : range.startContainer.parentElement;
  const win = parent?.ownerDocument.defaultView;
  if (!parent || !win || !readingRangeVisible(range)) return false;
  const rect = rectsForRange(range)[0];
  let scroller = parent.parentElement;
  while (scroller && !/(auto|scroll|overlay)/.test(win.getComputedStyle(scroller).overflowY)) {
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
  if (!readingStartInViewport(range)) {
    try {
      parent.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    } catch { /* ignore in synthetic DOM environments */ }
  }
  return readingStartInViewport(range) || readingRangeVisible(range);
}

function computeClipRect(root: Element, doc: Document, win: Window) {
  let top = 0;
  let left = 0;
  let bottom = win.innerHeight || 99999;
  let right = win.innerWidth || 99999;
  const rootRect = root.getBoundingClientRect();
  if (rootRect.height > 0) {
    top = Math.max(top, rootRect.top);
    bottom = Math.min(bottom, rootRect.bottom);
  }
  if (rootRect.width > 0) {
    left = Math.max(left, rootRect.left);
    right = Math.min(right, rootRect.right);
  }
  const insideFrame = Boolean(win.frameElement);
  for (let el: Element | null = root.parentElement; el && el !== doc.documentElement; el = el.parentElement) {
    if (insideFrame && el === doc.body) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = win.getComputedStyle(el);
    const clipsPaint = style.contain?.includes('paint')
      || style.contain?.includes('strict')
      || style.contain?.includes('content');
    if (clipsPaint || /(hidden|clip|scroll|auto|overlay)/.test(style.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (clipsPaint || /(hidden|clip|scroll|auto|overlay)/.test(style.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
  }
  return { top, left, bottom, right, rootRect };
}

/**
 * Paint through the browser's range highlight registry where available, paired
 * with a non-blocking geometry overlay (`pointer-events: none`) for visible
 * start/end boundary rails & callouts. A geometry-only fallback also paints
 * line fills for WebViews without Custom Highlights and transparent PDF text layers.
 */
export function paintReadingPassage(
  root: Element,
  items: ReadonlyArray<DecoratedRange>,
  requestId: number,
  geometryOnly = false,
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win || !items.length) return () => {};
  const css = (win as Window & { CSS?: typeof CSS }).CSS;
  const Highlight = (win as Window & { Highlight?: new (...ranges: Range[]) => Highlight }).Highlight;
  const useCustomHighlights = Boolean(!geometryOnly && css?.highlights && Highlight);
  const name = `study-passage-${requestId}`;
  let style: HTMLStyleElement | undefined;
  const { fill, outline } = GUIDED_READING_HIGHLIGHT;

  if (useCustomHighlights && css?.highlights && Highlight) {
    const starts: Range[] = [];
    const ends: Range[] = [];
    for (const { range, start, end } of items) {
      if (start) starts.push(boundaryWord(range, true));
      if (end) ends.push(boundaryWord(range, false));
    }
    style = doc.createElement('style');
    style.dataset.studyDecoration = '';
    style.textContent = `
      ::highlight(${name}) {
        background-color: ${fill};
        text-shadow: 0 0 1px ${outline};
      }
      ::highlight(${name}-start) { text-decoration: underline 2px ${outline}; }
      ::highlight(${name}-end) { text-decoration: underline double 2px ${outline}; }
    `;
    (doc.head ?? doc.documentElement)?.appendChild(style);
    css.highlights.set(name, new Highlight(...items.map(({ range }) => range)));
    css.highlights.set(`${name}-start`, new Highlight(...starts));
    css.highlights.set(`${name}-end`, new Highlight(...ends));
  }

  const layer = doc.createElement('div');
  layer.dataset.studyDecoration = '';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;user-select:none;z-index:30';
  (doc.body ?? doc.documentElement)?.appendChild(layer);
  let frame = 0;
  const draw = () => {
    frame = 0;
    const fragment = doc.createDocumentFragment();
    const clip = computeClipRect(root, doc, win);

    function addRect(rect: DOMRect, boundary?: 'start' | 'end') {
      const top = Math.max(clip.top, rect.top);
      const bottom = Math.min(clip.bottom, rect.bottom);
      const left = Math.max(clip.left, rect.left);
      const right = Math.min(clip.right, rect.right);
      if (bottom <= top || right <= left) return;
      const mark = doc.createElement('span');
      mark.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;pointer-events:none;`;
      if (boundary) {
        mark.style.borderBottom = `2px ${boundary === 'end' ? 'double' : 'solid'} ${outline}`;
      } else {
        mark.style.background = fill;
        mark.style.borderRadius = '2px';
        mark.style.boxShadow = `inset 0 0 0 1px ${outline}`;
      }
      fragment.appendChild(mark);
    }

    function addBoundaryMarker(rect: DOMRect, kind: 'start' | 'end') {
      if (rect.right <= clip.left || rect.left >= clip.right) return;
      const markerHeight = 14;
      const barTop = kind === 'start' ? rect.top - 16 : rect.bottom + 2;
      if (barTop < clip.top || barTop + markerHeight > clip.bottom) return;
      const minLeft = clip.left + 4;
      const maxLeft = Math.max(minLeft, clip.right - 130);
      const barLeft = Math.max(minLeft, Math.min(rect.left, maxLeft));
      const availableWidth = clip.right - barLeft - 8;
      if (availableWidth < 40) return;
      const targetWidth = clip.rootRect.width
        ? Math.min(clip.rootRect.width - (barLeft - clip.rootRect.left) - 8, 420)
        : 320;
      const barWidth = Math.max(Math.min(120, availableWidth), Math.min(targetWidth, availableWidth));
      const marker = doc.createElement('div');
      marker.dataset.studyBoundary = kind;
      marker.style.cssText = [
        'position:absolute',
        `left:${barLeft}px`,
        `top:${barTop}px`,
        `width:${barWidth}px`,
        'display:flex',
        'align-items:center',
        'gap:6px',
        'pointer-events:none',
        'user-select:none',
      ].join(';');
      const badge = doc.createElement('span');
      badge.textContent = kind === 'start' ? 'START READING' : 'END OF SEGMENT';
      badge.style.cssText = [
        'font:700 9px/1 system-ui,sans-serif',
        'letter-spacing:0.06em',
        'padding:2px 6px',
        'border-radius:4px',
        'color:#fff',
        `background:${kind === 'start' ? '#ea580c' : '#9a3412'}`,
        'white-space:nowrap',
      ].join(';');
      const rule = doc.createElement('div');
      rule.style.cssText = `flex:1;height:0;border-top:2px ${kind === 'end' ? 'dashed' : 'solid'} rgba(234,88,12,0.75);`;
      if (kind === 'start') {
        marker.append(badge, rule);
      } else {
        marker.append(rule, badge);
      }
      fragment.appendChild(marker);
    }

    if (root.isConnected && clip.bottom > clip.top && clip.right > clip.left) {
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let minLeft = Infinity;
      let firstStartRect: DOMRect | undefined;
      let lastEndRect: DOMRect | undefined;

      for (const { range, start, end } of items) {
        const rects = rectsForRange(range);
        for (const rect of rects) {
          if (!useCustomHighlights) addRect(rect);
          const top = Math.max(clip.top, rect.top);
          const bottom = Math.min(clip.bottom, rect.bottom);
          const left = Math.max(clip.left, rect.left);
          const right = Math.min(clip.right, rect.right);
          if (bottom > top && right > left) {
            minTop = Math.min(minTop, top);
            maxBottom = Math.max(maxBottom, bottom);
            minLeft = Math.min(minLeft, left);
          }
        }
        if (start) {
          const wordRects = rectsForRange(boundaryWord(range, true));
          const startRects = wordRects.length ? wordRects : rects;
          if (!useCustomHighlights) {
            for (const rect of startRects) addRect(rect, 'start');
          }
          firstStartRect ??= startRects[0] ?? rects[0];
        }
        if (end) {
          const wordRects = rectsForRange(boundaryWord(range, false));
          const endRects = wordRects.length ? wordRects : rects;
          if (!useCustomHighlights) {
            for (const rect of endRects) addRect(rect, 'end');
          }
          lastEndRect = endRects[endRects.length - 1] ?? rects[rects.length - 1] ?? lastEndRect;
        }
      }

      if (Number.isFinite(minTop) && Number.isFinite(maxBottom) && maxBottom > minTop) {
        const railLeft = Math.max(clip.left + 2, Number.isFinite(minLeft) ? minLeft - 8 : clip.left + 4);
        if (railLeft + 3 <= clip.right) {
          const rail = doc.createElement('div');
          rail.dataset.studyBoundary = 'rail';
          rail.style.cssText = [
            'position:absolute',
            `left:${railLeft}px`,
            `top:${minTop}px`,
            'width:3px',
            `height:${maxBottom - minTop}px`,
            'border-radius:2px',
            'pointer-events:none',
          ].join(';');
          rail.style.background = 'rgba(249, 115, 22, 0.85)';
          fragment.appendChild(rail);
        }
      }
      if (firstStartRect) addBoundaryMarker(firstStartRect, 'start');
      if (lastEndRect) addBoundaryMarker(lastEndRect, 'end');
    }
    layer.replaceChildren(fragment);
  };
  const update = () => { if (!frame) frame = win.requestAnimationFrame(draw); };
  draw();
  const parentWin = win.frameElement?.ownerDocument?.defaultView;
  win.addEventListener('scroll', update, { capture: true, passive: true });
  win.addEventListener('resize', update);
  parentWin?.addEventListener('scroll', update, { capture: true, passive: true });
  parentWin?.addEventListener('resize', update);
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
  if (observer) {
    observer.observe(root);
    for (let el: Element | null = root.parentElement; el && el !== doc.documentElement; el = el.parentElement) {
      const style = win.getComputedStyle(el);
      if (/(hidden|clip|scroll|auto|overlay)/.test(style.overflowY)
        || /(hidden|clip|scroll|auto|overlay)/.test(style.overflowX)) {
        observer.observe(el);
      }
    }
  }
  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener('scroll', update, true);
    win.removeEventListener('resize', update);
    parentWin?.removeEventListener('scroll', update, true);
    parentWin?.removeEventListener('resize', update);
    observer?.disconnect();
    layer.remove();
    if (style) {
      style.remove();
      css?.highlights?.delete(name);
      css?.highlights?.delete(`${name}-start`);
      css?.highlights?.delete(`${name}-end`);
    }
  };
}

function boundaryWord(range: Range, start: boolean) {
  const result = range.cloneRange();
  if (start) {
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return result;
    const text = range.startContainer.textContent ?? '';
    const end = range.startContainer === range.endContainer ? range.endOffset : text.length;
    const slice = text.slice(range.startOffset, end);
    const match = slice.match(/^(\s*)(\S+)/u);
    if (match) {
      result.setStart(range.startContainer, range.startOffset + match[1].length);
      result.setEnd(range.startContainer, range.startOffset + match[1].length + match[2].length);
    }
  } else {
    if (range.endContainer.nodeType !== Node.TEXT_NODE) return result;
    const text = range.endContainer.textContent ?? '';
    const startOffset = range.startContainer === range.endContainer ? range.startOffset : 0;
    const slice = text.slice(startOffset, range.endOffset);
    const match = slice.match(/(\S+)(\s*)$/u);
    if (match) {
      result.setStart(range.endContainer, range.endOffset - match[2].length - match[1].length);
      result.setEnd(range.endContainer, range.endOffset - match[2].length);
    }
  }
  return result;
}

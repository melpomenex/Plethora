import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paintReadingPassage } from './paintReadingPassage';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

describe('paintReadingPassage', () => {
  let originalGetClientRects: (() => DOMRectList) | undefined;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalGetClientRects = Range.prototype.getClientRects;
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      cb(0);
      return 1;
    };
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    if (originalGetClientRects) {
      Range.prototype.getClientRects = originalGetClientRects;
    }
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function setupScrolledPdfDom(options: {
    scrollerRect: DOMRect;
    pageRect: DOMRect;
    textRects: DOMRect[];
  }) {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.style.overflowX = 'auto';
    scroller.getBoundingClientRect = () => options.scrollerRect;

    const page = document.createElement('div');
    page.className = 'textLayer';
    page.textContent = 'First line of passage. Second line of passage.';
    page.getBoundingClientRect = () => options.pageRect;

    scroller.appendChild(page);
    document.body.appendChild(scroller);

    const range = document.createRange();
    range.selectNodeContents(page);

    Range.prototype.getClientRects = function getClientRectsStub() {
      const list = [...options.textRects] as unknown as DOMRectList & DOMRect[];
      list.item = (index: number) => list[index] ?? null;
      return list;
    };

    return { scroller, page, range };
  }

  it('clips highlight rects and rail to the scroll container top instead of bleeding over the interface', () => {
    // Scroll container starts at y=84 (below tab bar + PDF toolbar)
    const { page, range } = setupScrolledPdfDom({
      scrollerRect: makeRect(50, 84, 700, 600),
      // PDF page has scrolled up so its top is above the toolbar (y=-20)
      pageRect: makeRect(100, -20, 600, 900),
      textRects: [
        // Line 1 is completely above the scroll container (y=20..40 < 84)
        makeRect(140, 20, 400, 20),
        // Line 2 straddles the scroll container top edge (y=74..94, clips to 84..94)
        makeRect(140, 74, 400, 20),
        // Line 3 is fully inside the scroll container (y=104..124)
        makeRect(140, 104, 400, 20),
      ],
    });

    const cleanup = paintReadingPassage(page, [{ range, start: true, end: true }], 1, true);
    const layer = document.body.querySelector<HTMLElement>('[data-study-decoration]');
    expect(layer).not.toBeNull();

    const fillMarks = Array.from(layer!.querySelectorAll<HTMLElement>('span')).filter(
      (el) => el.style.background,
    );
    // Line 1 should be completely clipped out; Line 2 clipped to top=84, height=10; Line 3 untouched
    expect(fillMarks).toHaveLength(2);
    expect(fillMarks[0].style.top).toBe('84px');
    expect(fillMarks[0].style.height).toBe('10px');
    expect(fillMarks[1].style.top).toBe('104px');
    expect(fillMarks[1].style.height).toBe('20px');

    // Rail should also start at y=84 (not above the scroll container)
    const rail = layer!.querySelector<HTMLElement>('[data-study-boundary="rail"]');
    expect(rail).not.toBeNull();
    expect(rail!.style.top).toBe('84px');
    expect(rail!.style.height).toBe('40px');

    // START READING marker would be at y=4 (20 - 16), above scroller top 84, so it must be hidden
    expect(layer!.querySelector('[data-study-boundary="start"]')).toBeNull();
    // END OF SEGMENT marker is at y=126 (124 + 2), inside scroller, so it should be visible
    const endMarker = layer!.querySelector<HTMLElement>('[data-study-boundary="end"]');
    expect(endMarker).not.toBeNull();
    expect(endMarker!.style.top).toBe('126px');

    cleanup();
  });

  it('paints nothing when the PDF page is scrolled completely above the scroll container', () => {
    const { page, range } = setupScrolledPdfDom({
      scrollerRect: makeRect(50, 84, 700, 600),
      // Page bottom (40) is above scroller top (84)
      pageRect: makeRect(100, -860, 600, 900),
      textRects: [makeRect(140, 10, 400, 20)],
    });

    const cleanup = paintReadingPassage(page, [{ range, start: true, end: true }], 2, true);
    const layer = document.body.querySelector<HTMLElement>('[data-study-decoration]');
    expect(layer).not.toBeNull();
    expect(layer!.children).toHaveLength(0);

    cleanup();
  });

  it('clips highlight rects horizontally when panned inside a narrow scroll container', () => {
    const { page, range } = setupScrolledPdfDom({
      scrollerRect: makeRect(60, 84, 300, 600),
      pageRect: makeRect(20, 100, 700, 800),
      // Text spans x=40..440, so it overflows left (60) and right (360) of scroller
      textRects: [makeRect(40, 140, 400, 20)],
    });

    const cleanup = paintReadingPassage(page, [{ range, start: true, end: true }], 3, true);
    const layer = document.body.querySelector<HTMLElement>('[data-study-decoration]');
    const fillMarks = Array.from(layer!.querySelectorAll<HTMLElement>('span')).filter(
      (el) => el.style.background,
    );
    expect(fillMarks).toHaveLength(1);
    expect(fillMarks[0].style.left).toBe('60px');
    expect(fillMarks[0].style.width).toBe('300px');

    cleanup();
  });
});

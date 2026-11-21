export function markPdfText(
  element: HTMLElement,
  ranges: Iterable<{ start: number; end: number }>,
  className: string,
  decorate?: (mark: HTMLElement) => void,
): number {
  const text = element.textContent ?? "";
  const fragment = element.ownerDocument.createDocumentFragment();
  let offset = 0;
  let count = 0;
  for (const { start, end } of ranges) {
    fragment.append(text.slice(offset, start));
    const mark = element.ownerDocument.createElement("mark");
    mark.className = className;
    mark.textContent = text.slice(start, end);
    decorate?.(mark);
    fragment.append(mark);
    offset = end;
    count += 1;
  }
  if (count > 0) {
    fragment.append(text.slice(offset));
    element.replaceChildren(fragment);
  }
  return count;
}

export function pdfTextMatchRanges(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

import type { PdfReflowBlock, PdfReflowPage } from "./pdfReflowTypes";
import type { ReactNode } from "react";
import type { StoredHighlight } from "./HighlightLayer";

export function safePdfLink(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://incrementum.invalid");
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return href;
  } catch {}
  return undefined;
}

function highlightedText(block: PdfReflowBlock, highlights: StoredHighlight[]): ReactNode {
  if (block.source.confidence < 0.8) return block.text;
  const match = highlights.find((highlight) => highlight.pageNumber === block.source.pageNumber
    && highlight.text.trim().length >= 2
    && block.text.toLocaleLowerCase().includes(highlight.text.trim().toLocaleLowerCase()));
  if (!match) return block.text;
  const start = block.text.toLocaleLowerCase().indexOf(match.text.trim().toLocaleLowerCase());
  const end = start + match.text.trim().length;
  return <>{block.text.slice(0, start)}<mark data-highlight-id={match.id} className={`pdf-reflow-highlight ${match.color}`}>{block.text.slice(start, end)}</mark>{block.text.slice(end)}</>;
}

function Block({ block, onViewOriginal, highlights, activeSearchBlockId }: { block: PdfReflowBlock; onViewOriginal?: (block: PdfReflowBlock) => void; highlights: StoredHighlight[]; activeSearchBlockId?: string | null }) {
  const common = {
    id: block.id,
    dir: block.direction,
    "data-pdf-page": block.source.pageNumber,
    "data-pdf-confidence": block.source.confidence,
  } as const;
  let content: ReactNode;
  switch (block.kind) {
    case "heading": content = <h2 {...common}>{block.text}</h2>; break;
    case "list": content = <ul {...common}>{(block.items ?? [block.text]).map((item, index) => <li key={index}>{item}</li>)}</ul>; break;
    case "table": content = (
      <div className="overflow-x-auto" role="region" aria-label="PDF table">
        <table {...common}><tbody>{(block.table ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
      </div>
    ); break;
    case "figure": content = <figure {...common}><figcaption>{block.text}</figcaption></figure>; break;
    case "caption": content = <figcaption {...common}>{block.text}</figcaption>; break;
    case "footnote": content = <aside {...common} role="note">{block.text}</aside>; break;
    case "equation": content = <div {...common} role="math" className="font-mono">{block.text}</div>; break;
    case "code": content = <pre {...common}><code>{block.text}</code></pre>; break;
    case "page-break": content = <hr {...common} aria-label={`Page ${block.source.pageNumber}`} />; break;
    default: {
      const href = safePdfLink(block.href);
      const text = highlightedText(block, highlights);
      content = <p {...common}>{href ? <a href={href} rel="noreferrer noopener" target="_blank">{text}</a> : text}</p>;
    }
  }
  return (
    <div className={`pdf-reflow-block group relative${activeSearchBlockId === block.id ? " pdf-reflow-search-target" : ""}`} data-pdf-reflow-block={block.id}>
      {content}
      {onViewOriginal && block.kind !== "page-break" && (
        <button type="button" className="pdf-reflow-source-action min-h-11 text-xs" onClick={() => onViewOriginal(block)}>
          Page {block.source.pageNumber}
        </button>
      )}
    </div>
  );
}

export function PdfReflowRenderer({
  pages,
  onViewOriginal,
  onRequestOcr,
  highlights = [],
  activeSearchBlockId,
}: {
  pages: PdfReflowPage[];
  onViewOriginal?: (block: PdfReflowBlock) => void;
  onRequestOcr?: (page: PdfReflowPage) => void;
  highlights?: StoredHighlight[];
  activeSearchBlockId?: string | null;
}) {
  return (
    <article className="pdf-reflow-content" aria-label="Reflowed PDF">
      {pages.map((page) => (
        <section key={page.pageNumber} aria-label={`PDF page ${page.pageNumber}`} data-pdf-reflow-page={page.pageNumber}>
          {page.state === "processing" && <p role="status">Preparing page {page.pageNumber}…</p>}
          {page.state === "ocr-required" && (
            <div role="status" className="rounded-xl border border-border p-4">
              <p>Page {page.pageNumber} needs text recognition.</p>
              {onRequestOcr && <button type="button" className="mt-2 min-h-11 rounded-md border border-border px-4" onClick={() => onRequestOcr(page)}>Recognize this page</button>}
            </div>
          )}
          {page.state === "failed" && <p role="alert">Page {page.pageNumber} is available in original view.</p>}
          {page.blocks.map((block) => <Block key={block.id} block={block} onViewOriginal={onViewOriginal} highlights={highlights} activeSearchBlockId={activeSearchBlockId} />)}
        </section>
      ))}
    </article>
  );
}

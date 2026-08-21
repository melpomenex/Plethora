import { useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import { renderMarkdown } from "../../utils/markdown";
import { useI18n } from "../../lib/i18n";
import { getHandbookMarkdown } from "./handbookContent";

type Heading = {
  level: number;
  title: string;
  id: string;
};

const stripInlineMarkdown = (value: string) =>
  value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_]+/g, "")
    .trim();

const slugify = (value: string) => {
  const trimmed = value.toLowerCase().replace(/[^\w\s-]/g, "").trim();
  const slug = trimmed.replace(/\s/g, "-");
  return slug || "section";
};

const parseHeadings = (text: string): Heading[] => {
  const lines = text.split(/\r?\n/);
  const seen = new Map<string, number>();
  const headings: Heading[] = [];
  let inCodeBlock = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;

    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) return;

    const level = match[1].length;
    const title = stripInlineMarkdown(match[2]);
    const base = slugify(title);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count > 1 ? `${base}-${count}` : base;
    headings.push({ level, title, id });
  });

  return headings;
};

const addHeadingIds = (html: string, headings: Heading[]) => {
  let index = 0;
  return html.replace(/<h([1-6]) class="([^"]*)">([\s\S]*?)<\/h\1>/g, (_match, level, className, content) => {
    const heading = headings[index++];
    if (!heading) {
      return `<h${level} class="${className}">${content}</h${level}>`;
    }
    return `<h${level} id="${heading.id}" class="${className} scroll-mt-24">${content}</h${level}>`;
  });
};

const fixInternalLinks = (html: string) =>
  html.replace(/<a([^>]*?)href="(#.*?)"([^>]*?)>/g, (_match, before, href, after) => {
    const cleaned = `${before}${after}`
      .replace(/\s*target="_blank"/g, "")
      .replace(/\s*rel="noreferrer"/g, "");
    return `<a${cleaned} href="${href}">`;
  });

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightSearchMatches = (html: string, query: string, activeMatch: number) => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { html, count: 0 };

  const matcher = new RegExp(escapeRegExp(normalizedQuery), "gi");
  let count = 0;
  const highlightedHtml = html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(matcher, (match) => {
        const matchIndex = count++;
        const activeClass = matchIndex === activeMatch ? " ring-2 ring-primary/60" : "";
        return `<mark data-handbook-match="${matchIndex}" class="rounded bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-700/60${activeClass}">${match}</mark>`;
      });
    })
    .join("");

  return { html: highlightedHtml, count };
};

export function HandbookSettings() {
  const { locale, t } = useI18n();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const handbookMarkdown = useMemo(() => getHandbookMarkdown(locale), [locale]);
  const headings = useMemo(() => parseHeadings(handbookMarkdown), [handbookMarkdown]);
  const rendered = useMemo(() => {
    const html = renderMarkdown(handbookMarkdown);
    return fixInternalLinks(addHeadingIds(html, headings));
  }, [handbookMarkdown, headings]);
  const highlighted = useMemo(
    () => highlightSearchMatches(rendered, searchQuery, activeMatch),
    [rendered, searchQuery, activeMatch]
  );
  const visibleHeadings = useMemo(() => {
    const contentsHeadings = headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return contentsHeadings;
    return contentsHeadings.filter((heading) => heading.title.toLocaleLowerCase().includes(normalizedQuery));
  }, [headings, searchQuery]);

  useEffect(() => {
    setActiveMatch(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!isSearchOpen || highlighted.count === 0) return;
    const match = articleRef.current?.querySelector(`[data-handbook-match="${activeMatch}"]`);
    match?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatch, highlighted.count, isSearchOpen]);

  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setActiveMatch(0);
  };

  const openSearch = () => {
    setIsSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const goToMatch = (direction: 1 | -1) => {
    if (highlighted.count === 0) return;
    setActiveMatch((current) => (current + direction + highlighted.count) % highlighted.count);
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("plethora-theme-backdrop-suspend", { detail: { suspended: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent("plethora-theme-backdrop-suspend", { detail: { suspended: false } }));
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("handbook.handbook")}</p>
            <h3 className="text-2xl font-semibold text-foreground mt-2">{t("handbook.userHandbook")}</h3>
            <p className="text-sm text-muted-foreground mt-2">
              {t("handbook.browseChapters")}
            </p>
          </div>

          {isSearchOpen ? (
            <div className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-sm sm:w-[min(100%,24rem)]">
              <MagnifyingGlass className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goToMatch(event.shiftKey ? -1 : 1);
                  } else if (event.key === "Escape") {
                    closeSearch();
                  }
                }}
                placeholder={t("handbook.searchPlaceholder")}
                aria-label={t("handbook.search")}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {searchQuery.trim() && (
                <span className="whitespace-nowrap px-1 text-xs text-muted-foreground" aria-live="polite">
                  {highlighted.count > 0 ? `${Math.min(activeMatch + 1, highlighted.count)}/${highlighted.count}` : "0"}
                </span>
              )}
              {highlighted.count > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => goToMatch(-1)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("handbook.previousMatch")}
                    title={t("handbook.previousMatch")}
                  >
                    <CaretLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToMatch(1)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("handbook.nextMatch")}
                    title={t("handbook.nextMatch")}
                  >
                    <CaretRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={closeSearch}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={openSearch}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t("handbook.search")}
              title={t("handbook.search")}
            >
              <MagnifyingGlass className="h-4 w-4" aria-hidden="true" />
              <span>{t("common.search")}</span>
            </button>
          )}
        </div>

        {/* Ask Plethora Interactive Banner */}
        <div className="mt-4 p-4 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-base font-bold flex-shrink-0">
              ✨
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground">Ask Plethora AI & Canonical Product Documentation</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Press <kbd className="px-1.5 py-0.5 rounded bg-background text-[11px] font-mono border border-border">Cmd+K</kbd> and type <kbd className="px-1.5 py-0.5 rounded bg-background text-[11px] font-mono text-primary-400 font-bold border border-border">?</kbd> to ask questions with grounded citations, or search 75 canonical product docs with 0ms direct lookups.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("open-command-center"));
            }}
            className="px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors whitespace-nowrap shadow-sm self-stretch sm:self-auto text-center"
          >
            Open Command Center (Cmd+K)
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="md:sticky md:top-6 md:w-60 md:shrink-0 self-start">
          <div className="border border-border rounded-lg bg-muted/30 p-4 max-h-[calc(100vh-12rem)] overflow-y-auto">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              {t("handbook.contents")}
            </div>
            <nav className="space-y-1 text-sm">
              {visibleHeadings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`block rounded px-2 py-1 text-foreground/80 hover:text-foreground hover:bg-muted transition-colors ${
                      heading.level === 3 ? "ml-3 text-xs" : ""
                    }`}
                  >
                    {heading.title}
                  </a>
                ))}
              {searchQuery.trim() && visibleHeadings.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">{t("handbook.searchNoSections")}</p>
              )}
            </nav>
          </div>
        </aside>

        <article ref={articleRef} className="border border-border rounded-xl bg-card p-6 md:p-8 shadow-sm md:flex-1">
          <div
            className="prose prose-sm sm:prose-base max-w-none prose-headings:font-semibold prose-h1:text-3xl prose-h1:tracking-tight prose-h1:mt-0 prose-h1:pb-4 prose-h1:border-b prose-h1:border-border prose-h2:text-2xl prose-h2:mt-10 prose-h2:pb-2 prose-h2:border-b prose-h2:border-border/60 prose-h3:text-lg prose-h3:mt-6 prose-hr:my-8 prose-p:leading-relaxed prose-a:font-medium"
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
          {searchQuery.trim() && highlighted.count === 0 && (
            <p className="mt-6 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              {t("handbook.searchNoMatches")}
            </p>
          )}
        </article>
      </div>
    </div>
  );
}

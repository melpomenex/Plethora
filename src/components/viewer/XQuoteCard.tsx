/**
 * XQuoteCard — a quoted post rendered inside its parent post on a subdued
 * secondary surface (distinct from main-thread posts): avatar, name, handle,
 * clamped text, media thumbnail, Open on X. Falls back to a plain
 * "View quoted post on X" card when the quote could not be resolved.
 */
import { memo } from "react";
import type { TwitterPost, TwitterQuotedPost } from "../../types/document";
import { openExternal } from "../../lib/tauri";
import { cn } from "../../utils";
import { ArrowSquareOut, CheckCircle } from "@phosphor-icons/react";
import { XThreadMediaGrid } from "./XThreadMediaGrid";

function AuthorAvatar({
  name,
  screenName,
  avatarUrl,
  size = 20,
}: {
  name: string;
  screenName: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`@${screenName}`}
        className="shrink-0 rounded-full bg-muted object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || "@"}
    </span>
  );
}

export const XQuoteCard = memo(function XQuoteCard({
  quote,
  parentPost,
}: {
  quote?: TwitterQuotedPost | null;
  parentPost: TwitterPost;
}) {
  const qUrl = quote?.url || `https://x.com/i/status/${parentPost.refIds?.[0] ?? ""}`;
  const screenName = quote?.author.screenName ?? parentPost.author.screenName;
  // Mirror of the backend's `is_unknown_author`: the quote resolved, but its
  // payload carried no parseable user and no URL-derived handle existed —
  // render a neutral header instead of the "Unknown (@unknown)" placeholder.
  const isUnknownAuthor =
    quote?.author.name === "Unknown" && quote?.author.screenName === "unknown";

  if (!quote) {
    // Unresolved quote (enrichment failed or pending) — subdued fallback card.
    return (
      <a
        href={qUrl}
        onClick={(e) => {
          e.preventDefault();
          if (qUrl.includes("/i/status/")) void openExternal(qUrl);
        }}
        data-testid="x-quote-fallback"
        className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border border-l-2 border-l-primary/50 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="inline-flex items-center gap-1.5">
          <ArrowSquareOut size={14} />
          View quoted post on X
        </span>
        <span className="truncate text-xs">@{screenName}</span>
      </a>
    );
  }

  return (
    <article
      data-testid="x-quote-card"
      aria-label={isUnknownAuthor ? "Quoted post" : `Quoted post by @${quote.author.screenName}`}
      className="mt-3 overflow-hidden rounded-xl border border-border border-l-2 border-l-primary/40 bg-muted/40"
    >
      <a
        href={quote.url}
        onClick={(e) => {
          e.preventDefault();
          void openExternal(quote.url);
        }}
        className="block px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div className="flex items-center gap-2">
          {isUnknownAuthor ? (
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quoted post
            </span>
          ) : (
            <>
              <AuthorAvatar
                name={quote.author.name}
                screenName={quote.author.screenName}
                avatarUrl={quote.author.avatarUrl}
                size={20}
              />
              <span className="truncate text-sm font-semibold text-foreground">
                {quote.author.name}
              </span>
              {quote.author.verified && (
                <CheckCircle
                  size={14}
                  weight="fill"
                  className="shrink-0 text-primary"
                  aria-label="Verified"
                />
              )}
              <span className="truncate text-xs text-muted-foreground">@{quote.author.screenName}</span>
            </>
          )}
          <ArrowSquareOut size={13} className="ml-auto shrink-0 text-muted-foreground" />
        </div>
        {quote.text && (
          <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {quote.text}
          </p>
        )}
        {quote.media.length > 0 && (
          <div className="pointer-events-none">
            <XThreadMediaGrid media={quote.media} postId={quote.id} />
          </div>
        )}
      </a>
    </article>
  );
});

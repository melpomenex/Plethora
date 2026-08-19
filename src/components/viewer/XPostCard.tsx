/**
 * XPostCard — one authored post in the native X thread reader: avatar/name/
 * handle/verified, `N / M` position, timestamp, full body with preserved
 * paragraph breaks (styled links/hashtags/mentions, no raw HTML), media grid,
 * quoted-post card, and an unobtrusive overflow menu (Extract Post, Create
 * Flashcard, Copy post text, Open on X). Engagement row only when values are
 * known. Stable `id="x-post-{post.id}"` anchors AI citations.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TwitterPost, TwitterExpandedUrl } from "../../types/document";
import { openExternal } from "../../lib/tauri";
import { cn } from "../../utils";
import { CheckCircle, DotsThree, Copy, NotePencil, ArrowSquareOut, Heart, Repeat, ChatCircle, BookmarkSimple } from "@phosphor-icons/react";
import { XThreadMediaGrid } from "./XThreadMediaGrid";
import { XQuoteCard } from "./XQuoteCard";

function formatTimestamp(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Render post text without raw HTML: URLs as anchors (trailing punctuation
 *  kept as plain text), hashtags/mentions as styled spans; everything else
 *  plain text. Safe by construction. */
export function renderPostText(text: string, postId: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"']+|#[^\s#@<>"']+|@[A-Za-z0-9_]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//i.test(part)) {
      // Keep trailing punctuation out of the href ("see https://x.com/a.").
      const m = part.match(/^(https?:\/\/[^\s<>"']*[^\s<>"',.;:!?)\]}"'])([.,;:!?)\]}]*)$/);
      const href = m ? m[1] : part;
      const trailing = m ? m[2] : "";
      return (
        <span key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            onClick={(e) => {
              e.preventDefault();
              void openExternal(href);
            }}
          >
            {href}
          </a>
          {trailing}
        </span>
      );
    }
    if (/^#/.test(part)) {
      return (
        <span key={i} className="font-medium text-primary">
          {part}
        </span>
      );
    }
    if (/^@/.test(part)) {
      return (
        <span key={i} className="font-medium text-primary/90">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Expand the tweet's t.co URL entities into clickable, real targets (the
 *  structured `expandedUrls` from GraphQL/syndication enrichment — the raw
 *  text renders `t.co/…` shortlinks, which are useless to a reader). Media
 *  preview links (pic.twitter.com) are already rendered by the media grid. */
function ExpandedLinks({ post }: { post: TwitterPost }) {
  const links = useMemo(() => {
    const all = post.expandedUrls ?? [];
    if (all.length === 0) return null;
    const seen = new Set<string>();
    const out: TwitterExpandedUrl[] = [];
    for (const u of all) {
      const href = u.expandedUrl || u.url;
      if (!href || /^https?:\/\/pic\.twitter\.com\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(u);
    }
    return out.length > 0 ? out : null;
  }, [post.expandedUrls]);

  if (!links) return null;
  return (
    <div data-testid="x-post-links" className="mt-2.5 flex flex-col gap-1">
      {links.map((u) => {
        const href = u.expandedUrl || u.url;
        return (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            onClick={(e) => {
              e.preventDefault();
              void openExternal(href);
            }}
          >
            {u.displayUrl || href}
          </a>
        );
      })}
    </div>
  );
}

function Engagement({ post }: { post: TwitterPost }) {
  const items: Array<{ icon: React.ReactNode; value: number; label: string }> = [];
  if (post.replyCount != null && post.replyCount > 0)
    items.push({ icon: <ChatCircle size={14} />, value: post.replyCount, label: "replies" });
  if (post.retweetCount != null && post.retweetCount > 0)
    items.push({ icon: <Repeat size={14} />, value: post.retweetCount, label: "reposts" });
  if (post.favoriteCount != null && post.favoriteCount > 0)
    items.push({ icon: <Heart size={14} />, value: post.favoriteCount, label: "likes" });
  if (post.bookmarkCount != null && post.bookmarkCount > 0)
    items.push({ icon: <BookmarkSimple size={14} />, value: post.bookmarkCount, label: "bookmarks" });
  if (items.length === 0) return null;

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);

  return (
    <div
      data-testid="x-post-engagement"
      aria-label={items.map((it) => `${fmt(it.value)} ${it.label}`).join(", ")}
      className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground"
    >
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1" aria-hidden="true">
          {it.icon}
          {fmt(it.value)}
        </span>
      ))}
    </div>
  );
}

export interface XPostCardProps {
  post: TwitterPost;
  totalPosts: number;
  onExtractPost?: (post: TwitterPost) => void;
  onCreateFlashcard?: (post: TwitterPost) => void;
}

export const XPostCard = memo(function XPostCard({
  post,
  totalPosts,
  onExtractPost,
  onCreateFlashcard,
}: XPostCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const copyText = useCallback(() => {
    void navigator.clipboard?.writeText(post.fullText || post.text).catch(() => undefined);
    setMenuOpen(false);
  }, [post.fullText, post.text]);

  const timestamp = formatTimestamp(post.createdAt);

  return (
    <article
      id={`x-post-${post.id}`}
      data-x-post={post.id}
      data-post-index={post.postIndex}
      aria-label={`Post ${post.postIndex} of ${totalPosts} by @${post.author.screenName}`}
      className={cn(
        "group relative rounded-2xl border border-transparent px-3 py-4 transition-colors hover:border-border hover:bg-card/40 sm:px-4",
        "focus-within:border-border"
      )}
    >
      <div className="flex items-center gap-2.5">
        {post.author.avatarUrl ? (
          <img
            src={post.author.avatarUrl}
            alt={`@${post.author.screenName}`}
            className="h-9 w-9 shrink-0 rounded-full bg-muted object-cover"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
          >
            {post.author.name.trim().charAt(0).toUpperCase() || "@"}
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1">
            <span className="truncate text-[15px] font-semibold text-foreground">
              {post.author.name || `@${post.author.screenName}`}
            </span>
            {post.author.verified && (
              <CheckCircle
                size={15}
                weight="fill"
                className="shrink-0 text-primary"
                aria-label="Verified"
              />
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">@{post.author.screenName}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {post.postIndex} / {totalPosts}
            </span>
            {timestamp && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{timestamp}</span>
              </>
            )}
          </div>
        </div>

        {/* Overflow menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Post actions"
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <DotsThree size={18} weight="bold" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              data-testid="x-post-menu"
              className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg"
            >
              {[
                {
                  icon: <NotePencil size={15} />,
                  label: "Extract Post",
                  action: () => {
                    setMenuOpen(false);
                    onExtractPost?.(post);
                  },
                },
                {
                  icon: <Copy size={15} />,
                  label: "Create Flashcard",
                  action: () => {
                    setMenuOpen(false);
                    onCreateFlashcard?.(post);
                  },
                },
                { icon: <Copy size={15} />, label: "Copy post text", action: copyText },
                {
                  icon: <ArrowSquareOut size={15} />,
                  label: "Open on X",
                  action: () => {
                    setMenuOpen(false);
                    void openExternal(post.url);
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={item.action}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5 text-[15px] leading-relaxed text-foreground">
        <p className="whitespace-pre-wrap break-words">{renderPostText(post.fullText || post.text, post.id)}</p>
      </div>

      <ExpandedLinks post={post} />

      <XThreadMediaGrid media={post.media} postId={post.id} />

      <XQuoteCard quote={post.quotedPost} parentPost={post} />

      <Engagement post={post} />
    </article>
  );
});

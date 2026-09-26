/**
 * Article link routing for the saved-web-article reader (change:
 * hyperlink-selection-context-actions, design D5).
 *
 * Links inside a sanitized article iframe are untrusted navigation intents.
 * Same-document fragments (footnotes, back-links) navigate natively inside
 * the iframe; everything else is classified here and routed by the host —
 * the reader iframe itself must never navigate away from the article.
 */

import type { ReactNode } from "react";

/** Schemes article links may route to; everything else never activates. */
export const ARTICLE_LINK_SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
]);

export interface ArticleLinkTarget {
  /** Absolute URL, resolved against the document's base URI. */
  url: string;
  /** mailto: links have no browser/import path — the OS handler owns them. */
  mailto: boolean;
}

export type ArticleLinkClassification =
  | ArticleLinkTarget
  /** In-page fragment (`#footnote`) — navigate natively, no routing. */
  | "fragment"
  /** Scheme outside the safe set (javascript:, data:, …) — never activate. */
  | "unsafe"
  /** No usable href. */
  | null;

/**
 * Classify an anchor's href from inside the reader iframe. Relative hrefs
 * resolve against `baseUri` (the iframe's base, injected by the reader
 * preparation step).
 */
export function classifyArticleLink(
  href: string | null | undefined,
  baseUri: string | null | undefined,
): ArticleLinkClassification {
  if (!href) return null;
  if (href.startsWith("#")) return "fragment";
  let url: URL;
  try {
    url = new URL(href, baseUri ?? undefined);
  } catch {
    return "unsafe";
  }
  if (!ARTICLE_LINK_SAFE_PROTOCOLS.has(url.protocol)) return "unsafe";
  return { url: url.toString(), mailto: url.protocol === "mailto:" };
}

/**
 * Anchor element for a DOM event target, if the event happened on/inside a
 * link. Returns null for events elsewhere in the article body.
 *
 * Duck-typed on purpose: reader-iframe elements are not `instanceof` the
 * parent window's Element constructor (separate realms even same-origin).
 */
export function anchorFromEventTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  return (target as Element).closest("a[href]");
}

/** Menu item shape shared with the app's context menu (structural). */
export interface ArticleLinkMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

export interface ArticleLinkMenuActions {
  /** Default activation: in-app browser (desktop) / import (mobile). */
  onOpen(target: { url: string; mailto: boolean }): void;
  /** Save to Plethora — run the article import pipeline. */
  onSave(url: string): void;
  /** Hand off to the platform's external handler. */
  onOpenExternal(url: string): void;
  /** Copy the link address. */
  onCopyLink(url: string): void;
}

/**
 * The in-article link action menu: Open · Save to Plethora · Open externally
 * · Copy link. Built once here so the viewer render and the tests share the
 * exact same dispatch (mailto links have no import path — Save is disabled).
 */
export function buildArticleLinkMenuItems(params: {
  url: string;
  mailto: boolean;
  t: (key: string) => string;
  icons?: { open?: ReactNode; save?: ReactNode; external?: ReactNode; copy?: ReactNode };
  actions: ArticleLinkMenuActions;
}): ArticleLinkMenuItem[] {
  const { url, mailto, t, icons, actions } = params;
  const openTarget = { url, mailto };
  return [
    {
      id: "article-link-open",
      label: t("articleLink.open"),
      icon: icons?.open,
      onClick: () => actions.onOpen(openTarget),
    },
    {
      id: "article-link-save",
      label: t("articleLink.saveToPlethora"),
      icon: icons?.save,
      disabled: mailto,
      onClick: () => actions.onSave(openTarget.url),
    },
    {
      id: "article-link-external",
      label: t("articleLink.openExternal"),
      icon: icons?.external,
      onClick: () => actions.onOpenExternal(openTarget.url),
    },
    {
      id: "article-link-copy",
      label: t("articleLink.copyLink"),
      icon: icons?.copy,
      onClick: () => actions.onCopyLink(openTarget.url),
    },
  ];
}

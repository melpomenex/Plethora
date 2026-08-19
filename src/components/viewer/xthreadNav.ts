/**
 * Scroll-to-post navigation for the native X thread viewer.
 *
 * The viewer (`XThreadViewer`) listens for `plethora:xthread-scroll-to-post`
 * events dispatched by any consumer (assistant citation "Post N", extract
 * provenance navigation) and scrolls the post into view with a temporary
 * highlight ring. Post ids are stable anchors (`id="x-post-{post.id}"`).
 */
export const XTHREAD_SCROLL_EVENT = "plethora:xthread-scroll-to-post";

export interface XThreadScrollDetail {
  postId: string;
  /** Optional root id guard — ignored when the currently open thread has a
   *  different root (prevents cross-thread jumps). */
  rootId?: string;
}

export function scrollXThreadToPost(postId: string, rootId?: string): void {
  window.dispatchEvent(
    new CustomEvent<XThreadScrollDetail>(XTHREAD_SCROLL_EVENT, {
      detail: { postId, rootId },
    })
  );
}

/** Highlight duration before the ring fades (respects reduced motion). */
export const XTHREAD_HIGHLIGHT_MS = 2200;

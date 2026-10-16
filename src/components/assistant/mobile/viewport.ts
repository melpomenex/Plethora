export interface AssistantViewport { height: number; width: number; top: number; safeTop: number; safeBottom: number; keyboardHeight: number }
/** Consume scaffold-published metrics rather than installing another viewport listener. */
export function readAssistantViewport(): AssistantViewport {
  const css = getComputedStyle(document.documentElement);
  const shell = document.querySelector(".adaptive-shell-root");
  const safe = shell ? getComputedStyle(shell) : css;
  const px = (name: string, fallback = 0) => parseFloat(css.getPropertyValue(name)) || fallback;
  return { height: px("--app-viewport-height", window.innerHeight), width: window.innerWidth,
    top: px("--app-viewport-offset-top"), keyboardHeight: px("--app-keyboard-height"),
    safeTop: parseFloat(safe.paddingTop) || 0, safeBottom: parseFloat(safe.getPropertyValue("--shell-safe-bottom")) || 0 };
}
export function assistantPillBottom(viewport: AssistantViewport, navTop?: number): number {
  return navTop !== undefined && navTop > viewport.top && navTop <= viewport.top + viewport.height
    ? viewport.top + viewport.height - navTop + 8 : viewport.safeBottom + 12;
}

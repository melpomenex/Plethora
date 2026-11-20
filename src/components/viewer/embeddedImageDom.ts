export interface EmbeddedImageOpenDetails {
  src: string;
  alt?: string;
  caption?: string;
  trigger: HTMLImageElement;
}

export interface EmbeddedImageDomOptions {
  root: Document | HTMLElement;
  genericLabel: string | (() => string);
  open: (image: EmbeddedImageOpenDetails) => void;
  /** EPUB's pagination gestures also listen inside the content document. */
  suppressReaderGestures?: boolean;
}

const STYLE_ID = "plethora-embedded-image-viewer-styles";

export function resolveEmbeddedImageDetails(img: HTMLImageElement): EmbeddedImageOpenDetails | null {
  const src = img.currentSrc || img.src || img.getAttribute("src") || "";
  if (!src) return null;
  const caption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim() || undefined;
  const alt = img.alt?.trim() || undefined;
  return { src, alt, caption, trigger: img };
}

function closestImage(target: EventTarget | null, doc: Document): HTMLImageElement | null {
  const view = doc.defaultView;
  if (!view || !(target instanceof view.Element)) return null;
  if (target.tagName === "IMG") return target as HTMLImageElement;
  return target.closest("[data-embedded-image-viewer-wrap]")?.querySelector("img") as HTMLImageElement | null;
}

function addFrameStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .document-image-viewer-wrap { position:relative; display:inline-block; max-width:100%; vertical-align:middle; cursor:zoom-in; }
    .document-image-viewer-trigger { cursor:zoom-in !important; outline-offset:3px; }
    .document-image-viewer-trigger:focus-visible { outline:2px solid currentColor; border-radius:4px; }
    .document-image-viewer-affordance { position:absolute; right:5px; bottom:5px; display:flex; width:29px; height:29px; align-items:center; justify-content:center; border:1px solid Canvas; border-radius:7px; background:CanvasText; color:Canvas; opacity:0; pointer-events:none; }
    .document-image-viewer-affordance svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.8; }
    .document-image-viewer-wrap:hover .document-image-viewer-affordance, .document-image-viewer-wrap:focus-within .document-image-viewer-affordance { opacity:1; }
    @media (hover:none) { .document-image-viewer-affordance { opacity:1; } }
  `;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function decorateImage(img: HTMLImageElement, genericLabel: string): void {
  if (!img.hasAttribute("data-embedded-image-viewer-trigger")) {
    img.setAttribute("data-embedded-image-viewer-trigger", "true");
    img.setAttribute("role", "button");
    img.setAttribute("tabindex", "0");
    img.setAttribute("aria-haspopup", "dialog");
    img.classList.add("document-image-viewer-trigger");
  }
  const caption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
  img.setAttribute("aria-label", img.alt?.trim() || caption || genericLabel);
  if (!img.title) img.title = img.alt?.trim() || caption || genericLabel;

  let wrapper = img.parentElement?.closest<HTMLElement>("[data-embedded-image-viewer-wrap]");
  if (!wrapper) {
    wrapper = img.ownerDocument.createElement("span");
    wrapper.className = "document-image-viewer-wrap";
    wrapper.dataset.embeddedImageViewerWrap = "true";
    img.parentNode?.insertBefore(wrapper, img);
    wrapper.appendChild(img);
  }
  if (!wrapper.querySelector(".document-image-viewer-affordance")) {
    const affordance = img.ownerDocument.createElement("span");
    affordance.className = "document-image-viewer-affordance";
    affordance.setAttribute("aria-hidden", "true");
    const icon = img.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const iconPath = img.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    iconPath.setAttribute("d", "M4 9V4h5M4 4l6 6m10-1V4h-5m5 0-6 6M4 15v5h5m-5 0 6-6m10 1v5h-5m5 0-6-6");
    icon.appendChild(iconPath);
    affordance.appendChild(icon);
    wrapper.appendChild(affordance);
  }
}

/** Attach one delegated interaction bridge to a rendered document root. */
export function attachEmbeddedImageViewer(options: EmbeddedImageDomOptions): () => void {
  const { root, genericLabel, open, suppressReaderGestures = false } = options;
  const isDocumentRoot = root.nodeType === 9;
  const doc = isDocumentRoot ? root as Document : root.ownerDocument;
  addFrameStyles(doc);
  const readGenericLabel = () => typeof genericLabel === "function" ? genericLabel() : genericLabel;

  const decorateWithin = (node: ParentNode) => {
    if (node.nodeType === 1 && (node as Element).tagName === "IMG") decorateImage(node as HTMLImageElement, readGenericLabel());
    node.querySelectorAll?.("img").forEach((img) => decorateImage(img as HTMLImageElement, readGenericLabel()));
  };
  decorateWithin(root);

  const eventRoot: Document | HTMLElement = root;
  const handleClick = (event: Event) => {
    const img = closestImage(event.target, doc);
    if (!img) return;
    const details = resolveEmbeddedImageDetails(img);
    if (!details) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(details);
  };
  const handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
    const img = closestImage(keyboardEvent.target, doc);
    if (!img) return;
    const details = resolveEmbeddedImageDetails(img);
    if (!details) return;
    keyboardEvent.preventDefault();
    keyboardEvent.stopImmediatePropagation();
    open(details);
  };
  const stopReaderGesture = (event: Event) => {
    if (!suppressReaderGestures || !closestImage(event.target, doc)) return;
    event.stopImmediatePropagation();
  };

  eventRoot.addEventListener("click", handleClick, true);
  eventRoot.addEventListener("keydown", handleKeyDown, true);
  if (suppressReaderGestures) {
    eventRoot.addEventListener("pointerdown", stopReaderGesture, true);
    eventRoot.addEventListener("touchstart", stopReaderGesture, true);
    eventRoot.addEventListener("touchend", stopReaderGesture, true);
    eventRoot.addEventListener("touchcancel", stopReaderGesture, true);
  }

  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) decorateWithin(node as Element);
      });
    }
  });
  observer.observe(isDocumentRoot ? doc.documentElement : root, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    eventRoot.removeEventListener("click", handleClick, true);
    eventRoot.removeEventListener("keydown", handleKeyDown, true);
    if (suppressReaderGestures) {
      eventRoot.removeEventListener("pointerdown", stopReaderGesture, true);
      eventRoot.removeEventListener("touchstart", stopReaderGesture, true);
      eventRoot.removeEventListener("touchend", stopReaderGesture, true);
      eventRoot.removeEventListener("touchcancel", stopReaderGesture, true);
    }
  };
}

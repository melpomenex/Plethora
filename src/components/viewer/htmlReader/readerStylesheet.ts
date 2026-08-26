/** Reuse the app-owned reader stylesheet without rebuilding article nodes. */
export function ensureReaderStylesheet(doc: Document): HTMLStyleElement {
  const existing = doc.querySelector<HTMLStyleElement>('style#html-viewer-styles');
  if (existing) return existing;

  const style = doc.createElement('style');
  style.id = 'html-viewer-styles';
  // srcdoc inherits the host CSP. Packaged Tauri adds style nonces, which make
  // 'unsafe-inline' ineffective. Read the DOM property (getAttribute is hidden
  // by browsers), and authorize only our stylesheet before attaching it.
  // The host carrier lives in <head>, so React cannot remove it at startup.
  const nonce = document.querySelector<HTMLStyleElement>('style#plethora-style-nonce')?.nonce;
  if (nonce) style.nonce = nonce;
  (doc.head ?? doc.documentElement).appendChild(style);
  return style;
}

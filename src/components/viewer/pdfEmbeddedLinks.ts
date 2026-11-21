import { SimpleLinkService } from "pdfjs-dist/web/pdf_viewer.mjs";
import { isTauri, openExternal } from "../../lib/tauri";

// Keep the inherited named-action handlers detached from any PDF.js viewer.
// Plethora owns page navigation and never attaches a scripting manager.
export class PdfEmbeddedLinks extends SimpleLinkService {
  constructor(private readonly navigate: (destination: string | unknown[]) => Promise<void>) {
    super();
  }

  override async goToDestination(destination: string | unknown[]): Promise<void> {
    await this.navigate(destination);
  }

  override addLinkAttributes(link: HTMLAnchorElement, value: string): void {
    let url: URL | undefined;
    try {
      url = new URL(value);
    } catch {
      // A link must name an absolute external destination.
    }

    if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      link.setAttribute("aria-disabled", "true");
      return;
    }

    link.href = url.href;
    link.title = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (isTauri()) {
      link.onclick = (event) => {
        event.preventDefault();
        void openExternal(link.href);
      };
    }
  }
}

import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import "../index.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { useResolvedThemeAppearance } from "../themes/appearanceContext";
import { paperReaderCss } from "../themes/paperMaterialCss";
import { buildArticleReaderStyles } from "../components/viewer/htmlReader/articleReaderStyles";
import { ensureReaderStylesheet } from "../components/viewer/htmlReader/readerStylesheet";
import { PaperAppearanceControls } from "../components/settings/PaperAppearanceControls";
import { PaperMaterialPreview } from "../components/settings/PaperMaterialPreview";
import { useSettingsStore } from "../stores/settingsStore";
import { PAPER_PRESET_ID } from "../themes/materials";

declare global {
  interface Window {
    legalPadHarness: {
      setTheme: (id: string) => void;
      preview: (id: string | null) => void;
      detail: (value: "subtle" | "authentic" | "maximum") => void;
    };
  }
}
const content =
  '<!doctype html><html><head></head><body><article class="inc-article"><header><p class="inc-publication">READING NOTES</p><h1 class="inc-title">Ideas worth keeping</h1><p class="inc-dek">An illustrated reading fixture for paper, type and annotations.</p></header><div class="inc-body"><p id="selection-target">A well-read page holds a conversation between the author and the reader. Its texture should recede as the ideas come into focus.</p><h2>A place for careful thought</h2><p>The warm paper is a steady surface. Change the type size, select a passage, or follow <a href="#notes">the notes</a> without losing your place.</p><pre><code>const idea = read(passage);</code></pre><table><tr><th>Observation</th><th>Connection</th></tr><tr><td>Source integrity</td><td>Preserved</td></tr></table><p id="notes">References and original illustrations retain their meaning.</p></div></article></body></html>';
function Harness() {
  const { theme, appliedTheme, setTheme, previewTheme } = useTheme();
  const appearance = useResolvedThemeAppearance();
  const frame = useRef<HTMLIFrameElement>(null);
  const update = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || !appearance) return;
    ensureReaderStylesheet(doc).textContent =
      buildArticleReaderStyles(appearance.readerTokens, {
        fontSize: 18,
        lineHeight: 1.65,
        fontFamily: "serif",
      }) + paperReaderCss(appearance);
  };
  useEffect(update, [appearance]);
  window.legalPadHarness = {
    setTheme,
    preview: previewTheme,
    detail: (value) =>
      useSettingsStore
        .getState()
        .updateSettingsCategory("appearance", {
          materialPreferences: { [PAPER_PRESET_ID]: { detail: value, ruling: true, margin: true } },
        }),
  };
  return (
    <main
      data-ready={!!appearance}
      className="min-h-screen bg-background text-foreground"
      data-paper-surface="chrome"
    >
      <header
        data-paper-surface="chrome"
        className="flex items-center gap-4 border-b border-border p-4"
      >
        <strong>Plethora</strong>
        <span className="text-muted-foreground">Library · Reading · Review</span>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border p-4" data-paper-surface="inset">
            <h2 className="font-medium">{appliedTheme.name}</h2>
            <PaperMaterialPreview theme={appliedTheme} />
            <PaperAppearanceControls />
          </section>
          <button
            className="rounded-full bg-primary px-5 py-3 text-primary-foreground focus-visible:outline-2"
            onClick={() => setTheme(theme.id === "legal-pad" ? "obsidian-noir" : "legal-pad")}
          >
            Switch theme
          </button>
        </aside>
        <iframe
          ref={frame}
          title="Paper reader fixture"
          srcDoc={content}
          onLoad={update}
          className="h-[800px] w-full rounded-xl border border-border"
          style={{ background: appearance?.readerTokens.background }}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <PresentationProvider>
    <ThemeProvider defaultTheme="legal-pad">
      <Harness />
    </ThemeProvider>
  </PresentationProvider>
);

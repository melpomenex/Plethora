import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle } from "@phosphor-icons/react";
import "../index.css";
import "../styles/mobile.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { AdaptiveAppScaffold } from "../components/layout/AdaptiveAppScaffold";
import { BottomControlsGeometryProvider } from "../components/mobile/BottomControlsGeometry";
import { MobileAssistantContextProvider } from "../components/assistant/mobile/MobileAssistantContext";
import { MobileAssistantHost } from "../components/assistant/mobile/MobileAssistantHost";
import { ScrollOverlayControls } from "../components/queue/ScrollOverlayControls";
import { RatingOrb } from "../components/review/RatingOrb";

declare global {
  interface Window {
    ratingHarness: {
      setMobile: (value: boolean) => void;
      setFullscreen: (value: boolean) => void;
      setNewDocument: (value: boolean) => void;
      setRating: (value: boolean) => void;
      setEdge: (value: "left" | "right" | "top" | "bottom") => void;
      setTheme: (value: string) => void;
      themes: string[];
    };
  }
}

function Harness() {
  const navRef = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState<"left" | "right" | "top" | "bottom">("bottom");
  const [mobile, setMobile] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [newDocument, setNewDocument] = useState(false);
  const [rating, setRating] = useState(false);
  const [lastAction, setLastAction] = useState("none");
  const { theme, themes, setTheme } = useTheme();
  window.ratingHarness = { setMobile, setFullscreen, setNewDocument, setRating, setEdge, setTheme, themes: themes.map(t => t.id) };
  return <MobileAssistantContextProvider><BottomControlsGeometryProvider>
    <AdaptiveAppScaffold mobile={mobile} fullscreen={fullscreen}>
      <main className="mobile-main-content p-8 text-on-surface" style={{ background: "var(--color-background)", overflowY: "auto" }}>
        <article style={{ maxWidth: 680, marginInline: "auto", fontFamily: "Georgia, serif", fontSize: "1.25rem", lineHeight: 1.7 }}>
          <h1>Reading and remembering</h1>
          {Array.from({ length: 12 }, (_, i) => <p key={i}>Reading gives an idea room to grow. Revisiting a passage lets us notice its structure, connect it to earlier knowledge, and decide what deserves another look.</p>)}
        </article>
        <output id="last-action">{lastAction}</output><output id="active-theme">{theme.id}</output>
        <div style={{ position: "absolute", top: 160, left: 16 }}><RatingOrb action="good" title="Inline Good"><CheckCircle /></RatingOrb></div>
      </main>
      {mobile && <nav ref={navRef} className={`mobile-bottom-nav ${fullscreen ? "hidden" : ""}`} aria-hidden={fullscreen}>
        {["Dashboard", "Queue", "Review", "Documents", "Settings", "More"].map(label => <button key={label} style={{ minHeight: 56, fontSize: 11 }} onClick={() => setLastAction(label)}>{label}</button>)}
      </nav>}
      <ScrollOverlayControls showControls showRatingControls isMobile={mobile} currentIndex={0} totalItems={210}
        itemType="document" itemTitle="Reading and remembering" isNewDocument={newDocument} isRating={rating}
        scrollViewMode="document" ratingOrbsPosition={edge} onUpdateRatingOrbsPosition={setEdge}
        onExit={() => setLastAction("exit")} onShowSettings={() => {}} onShowRssSettings={() => {}} onSetScrollViewMode={() => {}} onOpenExtractDialog={() => {}}
        onRate={grade => setLastAction(`grade:${grade}`)} onDismiss={() => setLastAction("dismiss")}
        onGoToNext={() => setLastAction("next")} onGoToPrevious={() => setLastAction("previous")} />
      {mobile && <MobileAssistantHost navRef={navRef} fullscreen={fullscreen} />}
    </AdaptiveAppScaffold>
  </BottomControlsGeometryProvider></MobileAssistantContextProvider>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><PresentationProvider><Harness /></PresentationProvider></ThemeProvider>);

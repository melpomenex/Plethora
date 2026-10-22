/** Composed fixture: the real AssistantPanel, theme, and sheet focus owner. */
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { AssistantPanel } from "../components/assistant/AssistantPanel";
import { useDialogFocus } from "../components/md3/Dialog";
import { useLLMProvidersStore } from "../stores/llmProvidersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { loadLocale, type SupportedLocale } from "../lib/i18n";
import { requestLearningAgentMode } from "../lib/ai/assistant/learningAgentHandoff";
import { requestOverlayBack } from "../lib/overlayStack";
import type { ThemeId } from "../types/theme";

const params = new URLSearchParams(location.search);
const mobile = params.has("mobile");
const keyboard = params.has("keyboard");
const locale: SupportedLocale = params.get("locale") === "fr" ? "fr" : "en";
const theme: ThemeId = params.get("theme") ?? "milky-matcha";
const context = {
  type: "document" as const,
  documentId: "controls-fixture",
  content: "Music and identity: a conversation about navigating change.",
  metadata: { title: "What this musician’s identity crisis teaches us about navigating change" },
};
document.documentElement.style.fontSize = params.has("zoom") ? "200%" : "100%";
localStorage.removeItem("assistant-panel-conversations-v1");
useSettingsStore.setState(({ settings }) => ({ settings: {
  ...settings,
  general: { ...settings.general, language: locale },
  features: { ...settings.features, aiAgent: true },
} }));
useLLMProvidersStore.setState({ providers: [{
  id: "fixture", provider: "openai", name: "OpenAI", model: "gpt-4o",
  apiKey: "fixture-never-submitted", enabled: true, temperature: 0.7, maxTokens: 1024,
}] });
await loadLocale(locale);

declare global {
  interface Window {
    assistantControlsFixture: { openAgent: () => void; back: () => boolean };
  }
}
window.assistantControlsFixture = { openAgent: () => { requestLearningAgentMode(); }, back: () => requestOverlayBack() };

function Harness() {
  const [open, setOpen] = useState(true);
  const [partial, setPartial] = useState(params.has("partial"));
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useDialogFocus(mobile && open, () => setOpen(false), closeRef, { priority: 60, global: true, containFocus: !partial });
  const available = keyboard ? "calc(100dvh - 280px)" : "100dvh";
  if (!open) return <p>Assistant closed</p>;
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div style={{ height: available }} className="flex min-h-0 flex-col justify-end">
      <aside
        ref={sheetRef}
        data-harness-sheet
        style={{
          height: partial ? "60%" : "100%",
          width: mobile ? "100%" : Number(params.get("width") ?? 420),
          maxWidth: "100%",
          marginLeft: "auto",
        }}
        className="min-h-0 overflow-hidden"
      >
        <AssistantPanel context={context} fillContainer appendContextMessages={false}
          conversationKey="controls-fixture"
          mobilePresentation={mobile ? { visible: true, sheet: {
            detent: partial ? "partial" : "expanded", hasPartial: true,
            onClose: () => setOpen(false), onToggleDetent: () => setPartial((value) => !value), closeRef,
            source: { title: context.metadata.title, removed: false, onToggle: () => {} },
          } } : undefined}
        />
      </aside>
    </div>
    {keyboard && <div data-harness-keyboard className="flex h-[280px] items-center justify-center bg-muted text-muted-foreground">Keyboard viewport fixture</div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider defaultTheme={theme}><Harness /></ThemeProvider>);

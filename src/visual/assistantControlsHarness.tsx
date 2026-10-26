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
const pickerFixture = params.has("picker");
const position = params.get("side") === "left" ? "left" : "right";
const locale: SupportedLocale = ["en","de","es","fr","ja","zh"].includes(params.get("locale") ?? "") ? params.get("locale") as SupportedLocale : "en";
const theme: ThemeId = params.get("theme") ?? "milky-matcha";
const context = {
  type: "document" as const,
  documentId: "controls-fixture",
  content: "Music and identity: a conversation about navigating change.",
  ...(params.has("actions") ? { selection: "Complex cells convert nutrients into usable energy.", coverage: "window" as const, position: { pageNumber: 42 } } : {}),
  metadata: { title: "What this musician’s identity crisis teaches us about navigating change" },
};
document.documentElement.style.fontSize = params.has("zoom") ? "200%" : "100%";
localStorage.removeItem("assistant-panel-conversations-v1");
if (pickerFixture) localStorage.setItem("assistant-llm-provider", params.get("active") ?? "deepseek");
useSettingsStore.setState(({ settings }) => ({ settings: {
  ...settings,
  general: { ...settings.general, language: locale },
  features: { ...settings.features, aiAgent: true },
} }));
useLLMProvidersStore.setState({ providers: [{
  id: "fixture", provider: "openai", name: "OpenAI", model: "gpt-4o",
  apiKey: "fixture-never-submitted", enabled: true, temperature: 0.7, maxTokens: 1024,
}] });
if (pickerFixture) {
  useLLMProvidersStore.setState({ providers: [
    { id: "openai", provider: "openai", name: "OpenAI", model: "gpt-4o", apiKey: "fixture", enabled: true, temperature: 0.7, maxTokens: 1024 },
    { id: "ollama", provider: "ollama", name: "Ollama", model: "llama3.2:latest", apiKey: "", enabled: true, temperature: 0.7, maxTokens: 1024 },
    { id: "openrouter", provider: "openrouter", name: "OpenRouter", model: "openrouter/free", apiKey: "fixture", enabled: true, temperature: 0.7, maxTokens: 1024 },
    { id: "deepseek", provider: "deepseek", name: "DeepSeek", model: "deepseek-chat", apiKey: "fixture", enabled: true, temperature: 0.7, maxTokens: 1024 },
  ] });
}
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
  const viewportHeight = "var(--harness-viewport-height, 100dvh)";
  const available = keyboard ? `calc(${viewportHeight} - 280px)` : viewportHeight;
  if (!open) return <p>Assistant closed</p>;
  return <div style={{ minHeight: viewportHeight }} className="flex flex-col bg-background text-foreground">
    {pickerFixture && <div data-harness-reader className="fixed inset-y-0 w-1/2 overflow-auto" style={{ [position === "right" ? "left" : "right"]: 0 }}>
      {Array.from({ length: 40 }, (_, index) => <p key={index} className="p-4">{context.content}</p>)}
    </div>}
    <div style={{ height: available }} className="flex min-h-0 flex-col justify-end">
      <aside
        ref={sheetRef}
        data-harness-sheet
        style={{
          height: partial ? "60%" : "100%",
          width: mobile ? "100%" : Number(params.get("width") ?? 420),
          maxWidth: "100%",
          marginLeft: position === "right" ? "auto" : undefined,
        }}
        className="min-h-0 overflow-hidden"
      >
        <AssistantPanel context={context} position={position} fillContainer appendContextMessages={false}
          conversationKey="controls-fixture"
          mobilePresentation={mobile ? { visible: true, actionsSuppressed: keyboard, sheet: {
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

/**
 * Real-browser harness for the shared AI-engine picker.
 *
 * The reported defect: the mobile model menu drew past the Assistant sheet and
 * could not be scrolled, so lower providers were unreachable. This harness
 * mounts the REAL picker inside a sheet-shaped flex column with the same
 * handle/toolbar chrome and eight deterministic providers:
 *   - active Ollama, active OpenRouter, active DeepSeek, active Apple FM
 *   - a disabled provider, a key-missing provider, and two setup rows
 *
 * Query parameters:
 *   variant=desktop       render the anchored desktop menu inside a short pane
 *   detent=partial        constrain the mobile sheet to 52dvh
 *   text=200              enlarge the root font to 200%
 *
 * See `src/visual/assistant-model-picker.visual.spec.ts`.
 */
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatCircle, Code, Cpu, Gear, Globe, Sparkle, Waves } from "@phosphor-icons/react";
import "../index.css";
import {
  AssistantModelPicker,
  type AssistantProviderOption,
  type AssistantProviderStatus,
} from "../components/assistant/AssistantModelPicker";
import type { AssistantProviderId } from "../utils/assistantProvider";
import type { LLMProviderConfig } from "../stores/llmProvidersStore";

declare global {
  interface Window {
    __assistantModelPickerHarness?: {
      lastSelected: string | null;
      settingsOpened: number;
      closed: number;
    };
  }
}

const params = new URLSearchParams(window.location.search);
const variant = params.get("variant") === "desktop" ? "desktop" : "mobile";
const detent = params.get("detent") === "partial" ? "partial" : "expanded";
document.documentElement.style.fontSize = params.get("text") === "200" ? "200%" : "100%";

const provider = (
  id: AssistantProviderId,
  name: string,
  icon: AssistantProviderOption["icon"],
  color: string,
  gradient: string,
  breathingDot: string,
): AssistantProviderOption => ({ id, name, icon, color, gradient, breathingDot });

const providers: AssistantProviderOption[] = [
  provider("openai", "OpenAI", Sparkle, "text-emerald-500", "from-emerald-500/15 to-teal-500/5 hover:from-emerald-500/20", "bg-emerald-500 shadow-[0_0_8px_#10b981]"),
  provider("anthropic", "Anthropic", ChatCircle, "text-orange-500", "from-orange-500/15 to-amber-500/5 hover:from-orange-500/20", "bg-orange-500 shadow-[0_0_8px_#f97316]"),
  provider("gemini", "Gemini", Sparkle, "text-blue-400", "from-blue-400/15 to-indigo-500/5 hover:from-blue-400/20", "bg-blue-400 shadow-[0_0_8px_#60a5fa]"),
  provider("fixture-aurora" as AssistantProviderId, "Aurora Local", Globe, "text-rose-500", "from-rose-500/15 to-pink-500/5", "bg-rose-500"),
  provider("ollama", "Ollama", Code, "text-cyan-500", "from-cyan-500/15 to-blue-500/5 hover:from-cyan-500/20", "bg-cyan-500 shadow-[0_0_8px_#06b6d4]"),
  provider("openrouter", "OpenRouter", Gear, "text-purple-500", "from-purple-500/15 to-pink-500/5 hover:from-purple-500/20", "bg-purple-500 shadow-[0_0_8px_#a855f7]"),
  provider("ondevice-apple-foundation", "Apple Intelligence", Cpu, "text-slate-500", "from-slate-500/15 to-zinc-500/5 hover:from-slate-500/20", "bg-slate-500 shadow-[0_0_8px_#64748b]"),
  provider("deepseek", "DeepSeek", Waves, "text-blue-500", "from-blue-500/15 to-sky-500/5 hover:from-blue-500/20", "bg-blue-500 shadow-[0_0_8px_#3b82f6]"),
];

const configuredProviders: LLMProviderConfig[] = [
  { id: "openai", provider: "openai", name: "OpenAI", apiKey: "", model: "gpt-4o", enabled: true, temperature: 0.7, maxTokens: 4096 },
  { id: "anthropic", provider: "anthropic", name: "Anthropic", apiKey: "sk-ant", model: "claude-3.5-sonnet", enabled: false, temperature: 0.7, maxTokens: 4096 },
  { id: "ollama", provider: "ollama", name: "Ollama", apiKey: "", model: "llama3.2", enabled: true, temperature: 0.7, maxTokens: 4096 },
  { id: "openrouter", provider: "openrouter", name: "OpenRouter", apiKey: "sk-or", model: "openrouter/free", enabled: true, temperature: 0.7, maxTokens: 4096 },
  { id: "deepseek", provider: "deepseek", name: "DeepSeek", apiKey: "sk-ds", model: "deepseek-chat", enabled: true, temperature: 0.7, maxTokens: 4096 },
];

const statuses: Record<string, AssistantProviderStatus> = {
  openai: "key-missing",
  anthropic: "disabled",
  ollama: "active",
  openrouter: "active",
  "ondevice-apple-foundation": "active",
  deepseek: "active",
  "fixture-aurora": "not-configured",
};
const getStatus = (id: AssistantProviderId): AssistantProviderStatus => statuses[id] ?? "not-configured";

const harness = { lastSelected: null as string | null, settingsOpened: 0, closed: 0 };
window.__assistantModelPickerHarness = harness;

function Harness() {
  const [active, setActive] = useState<AssistantProviderId>("ollama");
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  const picker = open ? (
    <AssistantModelPicker
      variant={variant}
      className={variant === "mobile" ? "mx-2 mb-2 overflow-hidden rounded-2xl border border-border bg-surface-container-high" : undefined}
      providers={providers}
      configuredProviders={configuredProviders}
      activeProvider={active}
      getStatus={getStatus}
      onSelect={(id) => { harness.lastSelected = id; setActive(id); }}
      onConfigure={() => { harness.settingsOpened += 1; }}
      onClose={() => { harness.closed += 1; setOpen(false); }}
      returnFocusRef={returnFocusRef}
    />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
      <p>Picker closed</p>
      <button type="button" data-harness-reopen onClick={() => setOpen(true)} className="min-h-12 rounded-full border border-border px-4">
        Reopen picker
      </button>
    </div>
  );

  if (variant === "desktop") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", justifyContent: "flex-end", background: "var(--color-background, #ded8c8)" }}>
        <aside
          data-harness-sheet
          style={{
            width: 360,
            maxWidth: "100%",
            height: "min(520px, 100dvh)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderLeft: "1px solid var(--color-border, #b6ad99)",
            background: "var(--color-card, #f4ecd3)",
          }}
        >
          <div data-harness-toolbar style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 12px", borderBottom: "1px solid var(--color-border, #b6ad99)", fontSize: 14 }}>
            Assistant
          </div>
          <div style={{ position: "relative", padding: 12, flex: "0 0 auto" }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 12, color: "var(--color-muted-foreground, #6d6452)" }}>Model control</span>
            </div>
            {open && (
              <div
                className="glass-panel-heavy absolute right-3 top-9 z-50 w-72 rounded-xl border border-glass-border/40 bg-card/95 p-3 shadow-glass-lg backdrop-blur-md"
              >
                {picker}
              </div>
            )}
          </div>
          {!open && picker}
        </aside>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--color-background, #ded8c8)" }}>
      <div
        data-harness-sheet
        style={{
          height: detent === "partial" ? "52dvh" : "calc(100dvh - 12px)",
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: "20px 20px 0 0",
          background: "var(--color-card, #f4ecd3)",
          boxShadow: "0 -2px 16px rgb(0 0 0 / 18%)",
        }}
      >
        <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 32, height: 4, borderRadius: 9999, background: "var(--color-outline, #8a7a5a)" }} />
        </div>
        <div
          data-harness-toolbar
          style={{
            height: 48,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "0 12px",
            borderBottom: "1px solid var(--color-border, #b6ad99)",
            fontSize: 13,
          }}
        >
          <span className="truncate">Chaos</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span aria-hidden="true">⤢</span>
            <span aria-hidden="true">✕</span>
          </span>
        </div>
        {picker}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

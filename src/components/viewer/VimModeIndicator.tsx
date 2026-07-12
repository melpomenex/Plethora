import { useEffect, useState } from "react";
import { useVimModeStore, type VimMode, type VimOperator } from "../../stores/vimModeStore";
import { formatKeyCombo, getShortcutCombo, useShortcutStore } from "../common/KeyboardShortcuts";
import { useI18n } from "../../lib/i18n";

const MODE_LABELS: Record<Exclude<VimMode, "inactive">, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  "visual-line": "V-LINE",
};

const OPERATOR_LABELS: Record<VimOperator, string> = { d: "EXTRACT", c: "EDIT", y: "YANK" };
const COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
const COLOR_VALUES: Record<(typeof COLORS)[number], string> = { yellow: "253 230 138", green: "134 239 172", blue: "147 197 253", pink: "249 168 212", purple: "196 181 253" };

function emit(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
function act(action: "extract" | "extract-dialog" | "yank" | "highlight" | "flashcard", color?: string) {
  emit("vim-reading-action", { action, color });
}

export function VimModeIndicator() {
  const { t } = useI18n();
  const mode = useVimModeStore((s) => s.mode);
  const pendingSequence = useVimModeStore((s) => s.pendingSequence);
  const pendingOperator = useVimModeStore((s) => s.pendingOperator);
  const countPrefix = useVimModeStore((s) => s.countPrefix);
  const isResolving = useVimModeStore((s) => s.isResolving);
  const feedback = useVimModeStore((s) => s.feedback);
  const locationLabel = useVimModeStore((s) => s.locationLabel);
  const colorPickerOpen = useVimModeStore((s) => s.colorPickerOpen);
  const [dimmed, setDimmed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showHint, setShowHint] = useState(() => {
    try { return localStorage.getItem("vim-reading-hint-seen") !== "1"; } catch { return true; }
  });
  const chooseColor = colorPickerOpen;
  const setChooseColor = useVimModeStore((s) => s.setColorPickerOpen);
  const visual = mode === "visual" || mode === "visual-line";
  useShortcutStore((state) => state.shortcuts);
  const keyLabel = (id: string, fallback: string) => {
    const combo = getShortcutCombo(id);
    return combo ? formatKeyCombo(combo) : fallback;
  };

  useEffect(() => {
    if (mode === "inactive") return;
    setDimmed(false);
    const timeout = window.setTimeout(() => setDimmed(true), 2800);
    return () => window.clearTimeout(timeout);
  }, [mode, pendingSequence, pendingOperator, countPrefix, isResolving, feedback]);

  useEffect(() => { if (!visual) setChooseColor(false); }, [visual]);
  useEffect(() => {
    const open = () => setHelpOpen((value) => !value);
    window.addEventListener("vim-reading-help", open);
    return () => window.removeEventListener("vim-reading-help", open);
  }, []);
  useEffect(() => {
    if (mode === "inactive" || !showHint) return;
    const timeout = window.setTimeout(() => { setShowHint(false); try { localStorage.setItem("vim-reading-hint-seen", "1"); } catch { /* unavailable */ } }, 6500);
    return () => window.clearTimeout(timeout);
  }, [mode, showHint]);
  useEffect(() => {
    if (!chooseColor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setChooseColor(false); event.preventDefault(); return; }
      const index = Number(event.key) - 1;
      const color = COLORS[index];
      if (color) { act("highlight", color); setChooseColor(false); event.preventDefault(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.documentElement.style.removeProperty("--vim-selection-rgb"); };
  }, [chooseColor, setChooseColor]);
  if (mode === "inactive") return null;

  const pending = [countPrefix, pendingOperator, pendingSequence].filter(Boolean).join("");
  const modeLabel = pendingOperator ? `OPERATOR · ${OPERATOR_LABELS[pendingOperator]}` : MODE_LABELS[mode];

  return (
    <div className={`vim-reading-rail${visual ? " is-expanded" : ""}${dimmed ? " is-dimmed" : ""}`} role="status" aria-live="polite">
      <div className="vim-reading-rail__status">
        <span className={`vim-reading-rail__mode vim-reading-rail__mode--${mode}`}>{modeLabel}</span>
        {locationLabel && <span className="vim-reading-rail__location">{locationLabel}</span>}
        {pending && <kbd className="vim-reading-rail__pending">{pending}…</kbd>}
        {isResolving && <span className="vim-reading-rail__resolving">Moving…</span>}
        {feedback && <span className={`vim-reading-rail__feedback is-${feedback.kind}`}>{feedback.message}</span>}
      </div>
      {visual && (
        <div className="vim-reading-rail__actions" aria-label="Selection actions">
          <button type="button" onClick={() => act("extract")}><kbd>{keyLabel("vim.extract", "↵")}</kbd> Extract</button>
          <button type="button" onClick={() => act("extract-dialog")}><kbd>{keyLabel("vim.extract-dialog", "E")}</kbd> Edit</button>
          <button type="button" onClick={() => act("yank")}><kbd>{keyLabel("vim.yank", "Y")}</kbd> Copy</button>
          <button type="button" aria-expanded={chooseColor} onClick={() => setChooseColor(!chooseColor)}><kbd>{keyLabel("vim.highlight", "H")}</kbd> Highlight</button>
          <button type="button" onClick={() => act("flashcard")}><kbd>{keyLabel("vim.flashcard", "F")}</kbd> Card</button>
          <button type="button" onClick={() => emit("command-palette-open")}><kbd>:</kbd> More</button>
        </div>
      )}
      {visual && chooseColor && (
        <div className="vim-reading-rail__colors" role="group" aria-label="Highlight color">
          {COLORS.map((color, index) => (
            <button
              key={color}
              type="button"
              className={`is-${color}`}
              aria-label={`Highlight ${color}`}
              title={`${index + 1} · ${color}`}
              onFocus={() => document.documentElement.style.setProperty("--vim-selection-rgb", COLOR_VALUES[color])}
              onPointerEnter={() => document.documentElement.style.setProperty("--vim-selection-rgb", COLOR_VALUES[color])}
              onPointerLeave={() => document.documentElement.style.removeProperty("--vim-selection-rgb")}
              onClick={() => { act("highlight", color); setChooseColor(false); }}
            ><span>{index + 1}</span></button>
          ))}
          <button type="button" className="vim-reading-rail__cancel" onClick={() => setChooseColor(false)}>Esc</button>
        </div>
      )}
      {showHint && <div className="vim-reading-rail__hint">{t("vimReading.firstHint")}</div>}
      {helpOpen && (
        <div className="vim-reading-help" role="dialog" aria-label={t("vimReading.helpTitle")}>
          <strong>{t("vimReading.helpTitle")}</strong>
          <p>{t(visual ? "vimReading.helpVisual" : "vimReading.helpNormal")}</p>
          <button type="button" onClick={() => setHelpOpen(false)}>{t("vimReading.helpClose")}</button>
        </div>
      )}
    </div>
  );
}

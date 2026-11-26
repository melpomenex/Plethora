import { useEffect, useState } from "react";
import { Copy, NotePencil, Trash } from "@phosphor-icons/react";
import { useToast } from "../../common/Toast";

const SCRATCHPAD_STORAGE_KEY = "plethora_dashboard_scratchpad_v1";

function readScratchpad(): string {
  try {
    if (typeof window === "undefined" || !window.localStorage) return "";
    return window.localStorage.getItem(SCRATCHPAD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function ScratchpadWidget() {
  const [text, setText] = useState<string>(() => readScratchpad());
  const toast = useToast();

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(SCRATCHPAD_STORAGE_KEY, text);
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [text]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const handleCopy = () => {
    if (!text.trim()) return;
    void navigator.clipboard?.writeText(text).then(
      () => toast.success("Copied scratchpad to clipboard"),
      () => toast.error("Failed to copy scratchpad"),
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-violet-500/10 p-1.5 text-violet-500">
            <NotePencil className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Quick Scratchpad</h3>
            <p className="text-[11px] text-muted-foreground">
              {wordCount === 1 ? "1 word" : `${wordCount} words`} · Auto-saved locally
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!text.trim()}
            aria-label="Copy scratchpad"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setText("")}
            disabled={!text}
            aria-label="Clear scratchpad"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-40"
          >
            <Trash className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Jot down study intentions, questions, or quick notes..."
        rows={4}
        aria-label="Quick Scratchpad"
        className="w-full resize-y rounded-lg border border-border bg-background/70 p-3 text-xs md:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

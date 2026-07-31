import { useMemo, useState } from "react";
import type { TTSModelInfo } from "../../api/tts/types";

export interface ModelBrowserProps {
  models: TTSModelInfo[];
  currentModelId?: string;
  offline?: boolean;
  onSelect: (model: TTSModelInfo) => void;
  onClose: () => void;
  onRefresh?: () => void;
}

export function ModelBrowser({ models, currentModelId, offline = false, onSelect, onClose, onRefresh }: ModelBrowserProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id} ${model.vendor || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Model browser">
      <div className="flex max-h-[min(90vh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="shrink-0 space-y-3 border-b border-border p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Choose a model</h2><p className="text-xs text-muted-foreground">Search by model name or vendor.</p></div><div className="flex gap-2">{onRefresh && <button type="button" onClick={onRefresh} className="rounded border border-border px-3 py-1.5 text-sm">Refresh</button>}<button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm">Close</button></div></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" className="w-full rounded border border-border bg-background px-3 py-2 text-sm" />{offline && <span className="inline-block rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">Offline snapshot — may be out of date</span>}</div>
        <div className="min-h-0 overflow-y-auto p-4"><div className="grid gap-2 md:grid-cols-2">{filtered.map((model) => <button type="button" key={model.id} onClick={() => onSelect(model)} className={`rounded-lg border p-3 text-left ${model.id === currentModelId ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}><div className="flex items-start justify-between gap-2"><span className="font-medium">{model.name}</span>{model.costTier && <span className="rounded bg-muted px-2 py-0.5 text-xs">{model.costTier} cost</span>}</div><p className="mt-1 text-xs text-muted-foreground">{model.vendor || model.id} · {model.supportedVoices === null ? "Custom voices" : `${model.supportedVoices.length} voices`}</p>{model.costPerMillionTokens !== undefined && <p className="mt-1 text-xs text-muted-foreground">${model.costPerMillionTokens.toFixed(2)} / million input tokens</p>}<div className="mt-2 flex flex-wrap gap-1">{model.supportedParameters.map((parameter) => <span key={parameter} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{parameter}</span>)}</div></button>)}</div>{filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No models match this search.</p>}</div>
      </div>
    </div>
  );
}

export default ModelBrowser;

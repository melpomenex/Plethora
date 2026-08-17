import { useEffect, useMemo, useRef, useState } from "react";
import type { TTSProviderId, TTSVoiceInfo } from "../../api/tts/types";
import { useModal } from "../common/Modal";

export interface ParsedVoiceMetadata {
  language?: string;
  gender?: string;
  style?: string;
}

/** Conservative vendor-aware parsing; unknown identifiers intentionally stay untagged. */
export function parseVoiceMetadata(voice: Pick<TTSVoiceInfo, "id" | "language" | "gender" | "style" | "vendor">): ParsedVoiceMetadata {
  if (voice.language || voice.gender || voice.style) return { language: voice.language, gender: voice.gender, style: voice.style };
  const id = voice.id;
  const aura = id.match(/^aura-2-[^-]+-([a-z]{2}(?:-[A-Z]{2})?)$/);
  if (aura) return { language: aura[1] };
  const af = id.match(/^([a-z])([fm])_[^_]+$/i);
  if (af) return { gender: af[2].toLowerCase() === "f" ? "female" : "male" };
  const underscoredLanguage = id.match(/^([a-z]{2}(?:-[A-Z]{2})?)_[^_]+(?:_([a-z-]+))?$/);
  if (underscoredLanguage) return { language: underscoredLanguage[1], style: underscoredLanguage[2] };
  const namespaced = id.match(/^([a-z]{2}(?:-[A-Z]{2})?)-[^:]+:/);
  if (namespaced) return { language: namespaced[1] };
  return {};
}

export interface VoiceBrowserProps {
  voices: TTSVoiceInfo[];
  currentVoiceId?: string;
  currentProvider?: TTSProviderId | string;
  favorites?: string[];
  recents?: string[];
  offline?: boolean;
  isBilled?: boolean;
  samplePhrase?: string;
  onSelect: (voice: TTSVoiceInfo) => void;
  onClose: () => void;
  onPreview?: (voice: TTSVoiceInfo, phrase: string) => Promise<void>;
  onToggleFavorite?: (voice: TTSVoiceInfo) => void;
}

function labelFor(voice: TTSVoiceInfo): string {
  return [voice.name, voice.id, voice.modelId, voice.vendor].filter(Boolean).join(" ").toLowerCase();
}

export function VoiceBrowser({
  voices,
  currentVoiceId,
  currentProvider,
  favorites = [],
  recents = [],
  offline = false,
  isBilled = false,
  samplePhrase = "Welcome to Plethora. This is a voice preview.",
  onSelect,
  onClose,
  onPreview,
  onToggleFavorite,
}: VoiceBrowserProps) {
  const { confirm } = useModal();
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(80);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<Record<string, string>>({});
  const [costDisclosed, setCostDisclosed] = useState(false);
  const currentRef = useRef<HTMLButtonElement | null>(null);

  const decorated = useMemo(() => voices.map((voice) => ({ voice, meta: parseVoiceMetadata(voice) })), [voices]);
  const options = useMemo(() => ({
    providers: [...new Set(voices.map((voice) => voice.provider))].sort(),
    vendors: [...new Set(voices.map((voice) => voice.vendor).filter(Boolean))].sort() as string[],
    languages: [...new Set(decorated.map(({ meta }) => meta.language).filter(Boolean))].sort() as string[],
    genders: [...new Set(decorated.map(({ meta }) => meta.gender).filter(Boolean))].sort() as string[],
    styles: [...new Set(decorated.map(({ meta }) => meta.style).filter(Boolean))].sort() as string[],
  }), [voices, decorated]);

  const filtered = useMemo(() => decorated.filter(({ voice, meta }) => {
    const haystack = labelFor(voice);
    return (!query.trim() || haystack.includes(query.trim().toLowerCase()))
      && (!providerFilter || voice.provider === providerFilter)
      && (!vendorFilter || voice.vendor === vendorFilter)
      && (!languageFilter || meta.language === languageFilter)
      && (!genderFilter || meta.gender === genderFilter)
      && (!styleFilter || meta.style === styleFilter);
  }), [decorated, query, providerFilter, vendorFilter, languageFilter, genderFilter, styleFilter]);

  const filteredVoices = filtered.map(({ voice }) => voice);
  const favoriteVoices = filteredVoices.filter((voice) => favorites.includes(voice.id));
  const unavailableFavorites = favorites.filter((id) => !voices.some((voice) => voice.id === id));
  const recentVoices = recents.map((id) => filteredVoices.find((voice) => voice.id === id)).filter((voice): voice is TTSVoiceInfo => Boolean(voice));
  const activeFilters = [query && `search “${query}”`, providerFilter && `provider ${providerFilter}`, vendorFilter && `vendor ${vendorFilter}`, languageFilter && `language ${languageFilter}`, genderFilter && `gender ${genderFilter}`, styleFilter && `style ${styleFilter}`].filter(Boolean) as string[];

  useEffect(() => {
    setVisibleCount(80);
    setTimeout(() => currentRef.current?.scrollIntoView({ block: "center" }), 0);
  }, [query, providerFilter, vendorFilter, languageFilter, genderFilter, styleFilter, currentVoiceId]);

  const clearFilters = () => {
    setQuery("");
    setProviderFilter("");
    setVendorFilter("");
    setLanguageFilter("");
    setGenderFilter("");
    setStyleFilter("");
  };

  const preview = async (voice: TTSVoiceInfo) => {
    if (!onPreview) return;
    if (isBilled && !costDisclosed) {
      const confirmed = await confirm(
        "Voice previews may consume provider API credits. Continue?",
        "Voice preview",
        { confirmText: "Continue", cancelText: "Cancel", variant: "warning" },
      );
      if (!confirmed) return;
      setCostDisclosed(true);
    }
    setPreviewingId(voice.id);
    setPreviewError((previous) => ({ ...previous, [voice.id]: "" }));
    try {
      await onPreview(voice, samplePhrase);
    } catch (error) {
      setPreviewError((previous) => ({ ...previous, [voice.id]: error instanceof Error ? error.message : "Preview failed." }));
    } finally {
      setPreviewingId((previous) => previous === voice.id ? null : previous);
    }
  };

  const renderVoice = (voice: TTSVoiceInfo) => {
    const metadata = parseVoiceMetadata(voice);
    const isCurrent = voice.id === currentVoiceId;
    const isFavorite = favorites.includes(voice.id);
    return (
      <button
        key={`${voice.provider}:${voice.modelId}:${voice.id}`}
        ref={isCurrent ? currentRef : undefined}
        type="button"
        onClick={() => onSelect(voice)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition ${isCurrent ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{voice.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{voice.provider} · {voice.vendor || "Unknown vendor"} · {voice.modelId}</span>
          <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            {metadata.language && <span className="rounded bg-muted px-1.5 py-0.5">{metadata.language}</span>}
            {metadata.gender && <span className="rounded bg-muted px-1.5 py-0.5">{metadata.gender}</span>}
            {metadata.style && <span className="rounded bg-muted px-1.5 py-0.5">{metadata.style}</span>}
          </span>
          {previewError[voice.id] && <span className="mt-1 block text-xs text-destructive">{previewError[voice.id]}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {onToggleFavorite && <span role="button" tabIndex={0} aria-label={isFavorite ? "Remove favorite" : "Add favorite"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(voice); }} className="rounded border border-border px-2 py-1 text-xs">{isFavorite ? "★" : "☆"}</span>}
          {onPreview && <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void preview(voice); }} className="rounded border border-border px-2 py-1 text-xs">{previewingId === voice.id ? "…" : "Preview"}</span>}
          {isCurrent && <span className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">Current</span>}
        </span>
      </button>
    );
  };

  const shown = filteredVoices.slice(0, visibleCount);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Voice browser">
      <div className="flex max-h-[min(90vh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Choose a voice</h2><p className="text-xs text-muted-foreground">Search by voice, model, or vendor.</p></div><button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm">Close</button></div>
          <div className="flex flex-wrap gap-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voices" className="min-w-[14rem] flex-1 rounded border border-border bg-background px-3 py-2 text-sm" />
            {([["Provider", providerFilter, setProviderFilter, options.providers], ["Vendor", vendorFilter, setVendorFilter, options.vendors], ["Language", languageFilter, setLanguageFilter, options.languages], ["Gender", genderFilter, setGenderFilter, options.genders], ["Style", styleFilter, setStyleFilter, options.styles]] as const).map(([label, value, setter, values]) => <select key={label} value={value} onChange={(event) => setter(event.target.value)} className="rounded border border-border bg-background px-2 py-2 text-sm"><option value="">{label}</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>)}
            {activeFilters.length > 0 && <button type="button" onClick={clearFilters} className="rounded border border-border px-2 py-2 text-sm">Clear filters</button>}
          </div>
          <div className="flex flex-wrap gap-1.5">{activeFilters.map((filter) => <span key={filter} className="rounded-full bg-muted px-2 py-1 text-xs">{filter}</span>)}{offline && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">Offline snapshot — may be out of date</span>}</div>
        </div>
        <div className="min-h-0 overflow-y-auto p-4" onScroll={(event) => { const element = event.currentTarget; if (element.scrollTop + element.clientHeight >= element.scrollHeight - 200) setVisibleCount((count) => Math.min(filteredVoices.length, count + 80)); }}>
          {filteredVoices.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No voices match {activeFilters.join(", ") || "the current criteria"}. <button type="button" onClick={clearFilters} className="text-primary underline">Clear them</button></div> : <div className="space-y-2">
            {(favoriteVoices.length > 0 || unavailableFavorites.length > 0) && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Favorites</h3><div className="space-y-2">{favoriteVoices.map(renderVoice)}{unavailableFavorites.map((id) => <button key={id} type="button" disabled className="flex w-full items-center justify-between rounded-lg border border-dashed border-border p-3 text-left opacity-60"><span><span className="block font-medium">{id}</span><span className="text-xs text-muted-foreground">Unavailable in the current catalog</span></span><span className="text-xs">Unavailable</span></button>)}</div></section>}
            {recentVoices.length > 0 && <section><h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recents</h3><div className="space-y-2">{recentVoices.map(renderVoice)}</div></section>}
            <section><h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All voices · {filteredVoices.length}</h3><div className="space-y-2">{shown.map(renderVoice)}</div></section>
          </div>}
        </div>
        {isBilled && <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">Previews use the selected provider and may consume API credit.</p>}
      </div>
    </div>
  );
}

export default VoiceBrowser;

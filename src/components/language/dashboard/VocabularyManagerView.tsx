import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Download, MagnifyingGlass, Trash, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils/cn";
import {
  deleteLanguageLexicalEntry,
  exportLanguageLexicon,
  listLanguageLexicalEntries,
  listLanguageOccurrences,
  listLanguageSurfaceForms,
  searchLanguageLexicalEntries,
} from "../../../api/languageLexicon";
import {
  importLanguageKnownWords,
  previewLanguageKnownWordImport,
  setLanguageKnowledgeStatesBatch,
} from "../../../api/languageKnowledge";
import type { LanguageLexicalEntry, LanguageOccurrence, LanguageSurfaceForm, LexiconPage } from "../../../types/languageLexicon";
import type { LanguageKnowledgeState } from "../../../types/languageKnowledge";
import { createCanonicalTab } from "../../tabs/TabRegistry";
import { useTabsStore } from "../../../stores";

const PAGE_SIZE = 50;

const STATE_FILTERS: ReadonlyArray<LanguageKnowledgeState> = [
  "new",
  "encountered",
  "learning",
  "familiar",
  "known",
  "ignored",
];

function formatCount(n: number): string {
  return n.toLocaleString();
}

/** Paged, state-filterable vocabulary manager with bulk operations. */
export function VocabularyManagerView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<LanguageKnowledgeState | "all">("all");
  const [page, setPage] = useState<LexiconPage<LanguageLexicalEntry> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<{ added: number; existing: number } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [groupByLemma, setGroupByLemma] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entryDetails, setEntryDetails] = useState<
    Record<string, { loading: boolean; surfaces: LanguageSurfaceForm[]; occurrences: LanguageOccurrence[] }>
  >({});

  const profileId = activeProfile?.id ?? null;
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (offset: number, opts: { query?: string; state?: LanguageKnowledgeState | "all"; replace?: boolean } = {}) => {
      if (!profileId) {
        setPage(null);
        return;
      }
      setLoading(true);
      setError(null);
      const activeQuery = (opts.query ?? query).trim();
      const activeState = opts.state ?? stateFilter;
      const filter = {
        profileId,
        query: activeQuery || undefined,
        languageTag: activeProfile?.targetLanguage,
        knowledgeState: activeState === "all" ? undefined : activeState,
        offset,
        limit: PAGE_SIZE,
      };
      const request =
        activeQuery || activeState !== "all"
          ? searchLanguageLexicalEntries(filter)
          : listLanguageLexicalEntries(profileId, { languageTag: filter.languageTag, offset, limit: PAGE_SIZE });
      request
        .then((result) => {
          setPage((prev) => (opts.replace || !prev ? result : { ...result, items: [...prev.items, ...result.items] }));
        })
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setLoading(false));
    },
    [profileId, query, stateFilter, activeProfile?.targetLanguage],
  );

  useEffect(() => {
    load(0, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => load(0, { replace: true }), 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, stateFilter]);

  useEffect(() => {
    const next = new Set<string>();
    for (const item of page?.items ?? []) if (selected.has(item.id)) next.add(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setSelected(next);
  }, [page?.items]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyStateToEntry = useCallback(
    async (entryId: string, state: LanguageKnowledgeState) => {
      if (!profileId) return;
      setApplying(true);
      try {
        await setLanguageKnowledgeStatesBatch([{ profileId, entryId, state }]);
        load(0, { replace: true });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setApplying(false);
      }
    },
    [profileId, load],
  );

  const applyStateToSelected = useCallback(
    async (state: LanguageKnowledgeState) => {
      if (!profileId || selected.size === 0) return;
      setApplying(true);
      try {
        await setLanguageKnowledgeStatesBatch(
          Array.from(selected, (entryId) => ({ profileId, entryId, state })),
        );
        setSelected(new Set());
        load(0, { replace: true });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setApplying(false);
      }
    },
    [profileId, selected, load],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!profileId || selected.size === 0) return;
    setApplying(true);
    try {
      for (const entryId of selected) {
        await deleteLanguageLexicalEntry(profileId, entryId);
      }
      setSelected(new Set());
      load(0, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  }, [profileId, selected, load]);

  const handleExport = useCallback(async () => {
    if (!profileId) return;
    try {
      const payload = await exportLanguageLexicon(profileId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vocabulary-${activeProfile?.targetLanguage ?? "export"}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [profileId, activeProfile?.targetLanguage]);

  const runPreview = useCallback(async () => {
    if (!profileId) return;
    setImportBusy(true);
    setImportPreview(null);
    try {
      const records = importText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((surface) => ({ word: surface, state: "known" as const }));
      const preview = await previewLanguageKnownWordImport(profileId, records);
      setImportPreview({ added: preview.newWords.length, existing: preview.duplicates.length });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportBusy(false);
    }
  }, [profileId, importText]);

  const runImport = useCallback(async () => {
    if (!profileId || !importPreview) return;
    setImportBusy(true);
    try {
      const records = importText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((surface) => ({ word: surface, state: "known" as const }));
      await importLanguageKnownWords(profileId, records);
      setImportOpen(false);
      setImportText("");
      setImportPreview(null);
      load(0, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportBusy(false);
    }
  }, [profileId, importText, importPreview, load]);

  const openSource = useCallback((documentId?: string) => {
    useTabsStore.getState().addTab(createCanonicalTab("documents"), undefined, "bootstrap");
    const target = documentId ? `/documents?id=${encodeURIComponent(documentId)}` : "/documents";
    window.dispatchEvent(new CustomEvent("navigate", { detail: target }));
  }, []);

  const toggleExpandEntry = useCallback(
    async (entryId: string) => {
      if (expandedId === entryId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(entryId);
      if (!profileId || entryDetails[entryId]) return;
      setEntryDetails((prev) => ({
        ...prev,
        [entryId]: { loading: true, surfaces: [], occurrences: [] },
      }));
      try {
        const [surfacePage, occurrencePage] = await Promise.all([
          listLanguageSurfaceForms(profileId, { entryId, limit: 20 }),
          listLanguageOccurrences(profileId, { entryId, limit: 10 }),
        ]);
        setEntryDetails((prev) => ({
          ...prev,
          [entryId]: {
            loading: false,
            surfaces: surfacePage.items ?? [],
            occurrences: occurrencePage.items ?? [],
          },
        }));
      } catch {
        setEntryDetails((prev) => ({
          ...prev,
          [entryId]: { loading: false, surfaces: [], occurrences: [] },
        }));
      }
    },
    [expandedId, profileId, entryDetails],
  );

  const rawItems = page?.items ?? [];
  const items = groupByLemma
    ? [...rawItems].sort((a, b) =>
        (a.lemma || a.canonicalForm || a.normalizedForm).localeCompare(b.lemma || b.canonicalForm || b.normalizedForm),
      )
    : rawItems;
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  return (
    <div className="mx-auto max-w-4xl p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("languageLearning.vocabulary.searchPlaceholder")}
            className="w-full rounded-lg bg-stone-800 py-2 pl-9 pr-3 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 placeholder:text-stone-500 focus:outline-none focus:ring-emerald-500"
          />
        </div>
        <button type="button" onClick={() => setGroupByLemma((prev) => !prev)} className={cn("rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset", groupByLemma ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-stone-800 text-stone-200 ring-stone-700 hover:bg-stone-700")}>
          {t("languageLearning.vocabulary.lemma")}
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className="rounded-lg bg-stone-800 px-3 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
          {t("languageLearning.vocabulary.import")}
        </button>
        <button type="button" onClick={() => void handleExport()} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
          <Download className="h-4 w-4" />
          {t("languageLearning.vocabulary.export")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setStateFilter("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
            stateFilter === "all" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-stone-800 text-stone-400 ring-stone-700 hover:text-stone-200",
          )}
        >
          {t("languageLearning.vocabulary.stateAll")}
        </button>
        {STATE_FILTERS.map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => setStateFilter(state)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
              stateFilter === state ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-stone-800 text-stone-400 ring-stone-700 hover:text-stone-200",
            )}
          >
            {t(`languageLearning.knowledgeState.${state}`)}
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-stone-800/60 p-3 ring-1 ring-inset ring-stone-700/60">
          <span className="text-sm text-stone-300">{t("languageLearning.vocabulary.selectedCount", { count: String(selected.size) })}</span>
          {STATE_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              disabled={applying}
              onClick={() => void applyStateToSelected(state)}
              className="rounded-full bg-emerald-600/20 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/40 hover:bg-emerald-600/30 disabled:opacity-40"
            >
              {t(`languageLearning.vocabulary.markAs`, { state: t(`languageLearning.knowledgeState.${state}`) })}
            </button>
          ))}
          <button
            type="button"
            disabled={applying}
            onClick={() => void handleDeleteSelected()}
            className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 ring-1 ring-inset ring-red-500/40 hover:bg-red-500/25 disabled:opacity-40"
          >
            <Trash className="h-3.5 w-3.5" />
            {t("languageLearning.vocabulary.delete")}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-red-400">
          <WarningCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {loading && !page ? (
        <div className="mt-6 text-sm text-stone-400">{t("languageLearning.loading")}</div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-inset ring-stone-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-900 text-xs text-stone-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={(event) => {
                  setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set());
                }} className="h-4 w-4 accent-emerald-500" />
              </th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.word")}</th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.lemma")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("languageLearning.vocabulary.pos")}</th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.state")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("languageLearning.vocabulary.encounters")}</th>
              <th className="w-24 px-3 py-2 font-medium">{t("languageLearning.vocabulary.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/70 bg-stone-900/40">
            {items.map((item) => {
              const isExpanded = expandedId === item.id;
              const detail = entryDetails[item.id];
              const isIgnored = item.knowledgeState === "ignored" || item.ignored;
              const definitions = item.meanings?.length ? item.meanings : item.translations;
              const linkedCards = Object.keys(item.reviewRelationships ?? {});
              return (
                <Fragment key={item.id}>
                  <tr className={cn("hover:bg-stone-800/40", selected.has(item.id) && "bg-emerald-500/5")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-emerald-500" />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleExpandEntry(item.id)}
                        className="text-left font-medium text-stone-100 hover:text-emerald-300"
                      >
                        {item.canonicalForm || item.normalizedForm}
                      </button>
                      {definitions?.length ? (
                        <div className="truncate text-xs text-stone-400 max-w-[220px]">{definitions.slice(0, 2).join("; ")}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-stone-400">{item.lemma ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-stone-400 sm:table-cell">{item.partOfSpeech ?? "—"}</td>
                    <td className="px-3 py-2">
                      <select
                        value={item.knowledgeState ?? (item.ignored ? "ignored" : "new")}
                        disabled={applying}
                        onChange={(event) => void applyStateToEntry(item.id, event.target.value as LanguageKnowledgeState)}
                        className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-200 ring-1 ring-inset ring-stone-700 focus:outline-none focus:ring-emerald-500"
                      >
                        {STATE_FILTERS.map((state) => (
                          <option key={state} value={state}>{t(`languageLearning.knowledgeState.${state}`)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="hidden px-3 py-2 text-stone-400 md:table-cell">{formatCount(item.encounterCount)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {isIgnored ? (
                          <button type="button" disabled={applying} onClick={() => void applyStateToEntry(item.id, "learning")} className="text-xs text-amber-300 hover:underline">
                            Restore
                          </button>
                        ) : null}
                        {item.documentCount > 0 ? (
                          <button type="button" onClick={() => openSource()} className="text-xs text-emerald-400 hover:underline">
                            {t("languageLearning.vocabulary.source")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr key={`${item.id}-details`} className="bg-stone-950/60">
                      <td colSpan={7} className="px-4 py-3 text-xs text-stone-300">
                        {detail?.loading ? (
                          <span className="text-stone-400">{t("languageLearning.loading")}</span>
                        ) : (
                          <div className="space-y-2">
                            {definitions?.length ? (
                              <div>
                                <span className="font-medium text-stone-400">Meanings: </span>
                                {definitions.join("; ")}
                              </div>
                            ) : null}
                            {detail?.surfaces?.length ? (
                              <div>
                                <span className="font-medium text-stone-400">Surface forms: </span>
                                {detail.surfaces.map((s) => `${s.surface} (${s.occurrenceCount})`).join(", ")}
                              </div>
                            ) : null}
                            {linkedCards.length > 0 ? (
                              <div>
                                <span className="font-medium text-stone-400">Linked flashcards: </span>
                                {linkedCards.length}
                              </div>
                            ) : null}
                            {detail?.occurrences?.length ? (
                              <div className="space-y-1">
                                <div className="font-medium text-stone-400">Occurrences:</div>
                                {detail.occurrences.map((occ) => (
                                  <div key={occ.id} className="flex items-center justify-between gap-2 rounded bg-stone-900/70 px-2 py-1">
                                    <span className="truncate text-stone-300">{occ.contextText || occ.surface}</span>
                                    <button
                                      type="button"
                                      onClick={() => openSource(occ.documentId)}
                                      className="shrink-0 text-emerald-400 hover:underline"
                                    >
                                      {t("languageLearning.vocabulary.source")}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-stone-500">
                  {t("languageLearning.vocabulary.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page?.hasMore ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => load(page.offset + page.items.length)} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
            {t("languageLearning.loadMore")}
          </button>
        </div>
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-stone-900 p-5 ring-1 ring-inset ring-stone-700 shadow-2xl">
            <h3 className="text-sm font-semibold">{t("languageLearning.vocabulary.importTitle")}</h3>
            <p className="mt-1 text-xs text-stone-400">{t("languageLearning.vocabulary.importHint")}</p>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={6}
              className="mt-3 w-full rounded-lg bg-stone-800 p-3 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 focus:outline-none focus:ring-emerald-500"
            />
            <div className="mt-3 flex items-center gap-2">
              <button type="button" disabled={importBusy} onClick={() => void runPreview()} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700 disabled:opacity-40">
                {t("languageLearning.vocabulary.preview")}
              </button>
              {importPreview ? (
                <span className="text-xs text-stone-400">
                  {t("languageLearning.vocabulary.previewResult", { added: String(importPreview.added), existing: String(importPreview.existing) })}
                </span>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setImportOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800">
                {t("common.cancel")}
              </button>
              <button type="button" disabled={importBusy || !importPreview} onClick={() => void runImport()} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                {t("languageLearning.vocabulary.importConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

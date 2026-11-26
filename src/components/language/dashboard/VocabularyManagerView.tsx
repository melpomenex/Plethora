import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Download, MagnifyingGlass, Trash, WarningCircle } from "@phosphor-icons/react";
import { useIsActiveTab } from "../../common/Tabs/TabContent";
import { Dialog } from "../../md3/Dialog";
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
  const isActiveTab = useIsActiveTab();
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
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("languageLearning.vocabulary.searchPlaceholder")}
            className="w-full rounded-lg bg-surface-container py-2 pl-9 pr-3 text-sm text-foreground ring-1 ring-inset ring-border placeholder:text-muted-foreground md-focus-ring focus-visible:ring-primary"
          />
        </div>
        <button type="button" aria-pressed={groupByLemma} onClick={() => setGroupByLemma((prev) => !prev)} className={cn("rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset", groupByLemma ? "bg-secondary-container text-on-secondary-container ring-primary/40" : "bg-surface-container text-foreground ring-border hover:bg-surface-container-highest")}>
          {t("languageLearning.vocabulary.lemma")}
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className="rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest">
          {t("languageLearning.vocabulary.import")}
        </button>
        <button type="button" onClick={() => void handleExport()} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest">
          <Download className="h-4 w-4" />
          {t("languageLearning.vocabulary.export")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={stateFilter === "all"}
          onClick={() => setStateFilter("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
            stateFilter === "all" ? "bg-secondary-container text-on-secondary-container ring-primary/40" : "bg-surface-container text-muted-foreground ring-border hover:text-foreground",
          )}
        >
          {t("languageLearning.vocabulary.stateAll")}
        </button>
        {STATE_FILTERS.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={stateFilter === state}
            onClick={() => setStateFilter(state)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
              stateFilter === state ? "bg-secondary-container text-on-secondary-container ring-primary/40" : "bg-surface-container text-muted-foreground ring-border hover:text-foreground",
            )}
          >
            {t(`languageLearning.knowledgeState.${state}`)}
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
          <span className="text-sm text-foreground">{t("languageLearning.vocabulary.selectedCount", { count: String(selected.size) })}</span>
          {STATE_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              disabled={applying}
              onClick={() => void applyStateToSelected(state)}
              className="rounded-full bg-secondary-container px-3 py-1 text-xs font-medium text-on-secondary-container ring-1 ring-inset ring-primary/40 md-state md-focus-ring disabled:opacity-40"
            >
              {t(`languageLearning.vocabulary.markAs`, { state: t(`languageLearning.knowledgeState.${state}`) })}
            </button>
          ))}
          <button
            type="button"
            disabled={applying}
            onClick={() => void handleDeleteSelected()}
            className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/40 hover:bg-destructive/20 disabled:opacity-40"
          >
            <Trash className="h-3.5 w-3.5" />
            {t("languageLearning.vocabulary.delete")}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
          <WarningCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {loading && !page ? (
        <div className="mt-6 text-sm text-muted-foreground">{t("languageLearning.loading")}</div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-inset ring-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-container-high text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={(event) => {
                  setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set());
                }} className="h-4 w-4 accent-primary" />
              </th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.word")}</th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.lemma")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("languageLearning.vocabulary.pos")}</th>
              <th className="px-3 py-2 font-medium">{t("languageLearning.vocabulary.state")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("languageLearning.vocabulary.encounters")}</th>
              <th className="w-24 px-3 py-2 font-medium">{t("languageLearning.vocabulary.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {items.map((item) => {
              const isExpanded = expandedId === item.id;
              const detail = entryDetails[item.id];
              const isIgnored = item.knowledgeState === "ignored" || item.ignored;
              const definitions = item.meanings?.length ? item.meanings : item.translations;
              const linkedCards = Object.keys(item.reviewRelationships ?? {});
              return (
                <Fragment key={item.id}>
                  <tr className={cn("hover:bg-surface-container-low", selected.has(item.id) && "bg-primary/10")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-primary" />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleExpandEntry(item.id)}
                        className="text-left font-medium text-foreground hover:text-primary"
                      >
                        {item.canonicalForm || item.normalizedForm}
                      </button>
                      {definitions?.length ? (
                        <div className="truncate text-xs text-muted-foreground max-w-[220px]">{definitions.slice(0, 2).join("; ")}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.lemma ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{item.partOfSpeech ?? "—"}</td>
                    <td className="px-3 py-2">
                      <select
                        value={item.knowledgeState ?? (item.ignored ? "ignored" : "new")}
                        disabled={applying}
                        onChange={(event) => void applyStateToEntry(item.id, event.target.value as LanguageKnowledgeState)}
                        className="rounded-md bg-surface-container px-2 py-1 text-xs text-foreground ring-1 ring-inset ring-border md-focus-ring focus-visible:ring-primary"
                      >
                        {STATE_FILTERS.map((state) => (
                          <option key={state} value={state}>{t(`languageLearning.knowledgeState.${state}`)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{formatCount(item.encounterCount)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {isIgnored ? (
                          <button type="button" disabled={applying} onClick={() => void applyStateToEntry(item.id, "learning")} className="text-xs text-primary hover:underline">
                            Restore
                          </button>
                        ) : null}
                        {item.documentCount > 0 ? (
                          <button type="button" onClick={() => openSource()} className="text-xs text-primary hover:underline">
                            {t("languageLearning.vocabulary.source")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr key={`${item.id}-details`} className="bg-surface-container-low">
                      <td colSpan={7} className="px-4 py-3 text-xs text-foreground">
                        {detail?.loading ? (
                          <span className="text-muted-foreground">{t("languageLearning.loading")}</span>
                        ) : (
                          <div className="space-y-2">
                            {definitions?.length ? (
                              <div>
                                <span className="font-medium text-muted-foreground">Meanings: </span>
                                {definitions.join("; ")}
                              </div>
                            ) : null}
                            {detail?.surfaces?.length ? (
                              <div>
                                <span className="font-medium text-muted-foreground">Surface forms: </span>
                                {detail.surfaces.map((s) => `${s.surface} (${s.occurrenceCount})`).join(", ")}
                              </div>
                            ) : null}
                            {linkedCards.length > 0 ? (
                              <div>
                                <span className="font-medium text-muted-foreground">Linked flashcards: </span>
                                {linkedCards.length}
                              </div>
                            ) : null}
                            {detail?.occurrences?.length ? (
                              <div className="space-y-1">
                                <div className="font-medium text-muted-foreground">Occurrences:</div>
                                {detail.occurrences.map((occ) => (
                                  <div key={occ.id} className="flex items-center justify-between gap-2 rounded bg-surface-container px-2 py-1">
                                    <span className="truncate text-foreground">{occ.contextText || occ.surface}</span>
                                    <button
                                      type="button"
                                      onClick={() => openSource(occ.documentId)}
                                      className="shrink-0 text-primary hover:underline"
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
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("languageLearning.vocabulary.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page?.hasMore ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => load(page.offset + page.items.length)} className="rounded-full bg-surface-container px-4 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest">
            {t("languageLearning.loadMore")}
          </button>
        </div>
      ) : null}

      <Dialog
        open={importOpen && isActiveTab}
        onClose={() => setImportOpen(false)}
        title={t("languageLearning.vocabulary.importTitle")}
        description={t("languageLearning.vocabulary.importHint")}
        hideCloseButton
        footer={(
          <>
            <button type="button" onClick={() => setImportOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-container">
              {t("common.cancel")}
            </button>
            <button type="button" disabled={importBusy || !importPreview} onClick={() => void runImport()} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground md-state md-focus-ring disabled:opacity-40">
              {t("languageLearning.vocabulary.importConfirm")}
            </button>
          </>
        )}
      >
        <textarea
          aria-label={t("languageLearning.vocabulary.importTitle")}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          rows={6}
          className="w-full rounded-lg bg-surface-container p-3 text-sm text-foreground ring-1 ring-inset ring-border md-focus-ring focus-visible:ring-primary"
        />
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled={importBusy} onClick={() => void runPreview()} className="rounded-full bg-surface-container px-4 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest disabled:opacity-40">
            {t("languageLearning.vocabulary.preview")}
          </button>
          {importPreview ? (
            <span className="text-xs text-muted-foreground">
              {t("languageLearning.vocabulary.previewResult", { added: String(importPreview.added), existing: String(importPreview.existing) })}
            </span>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

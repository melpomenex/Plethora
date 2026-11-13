import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  acceptStudyPlanResearchSnapshot,
  cancelStudyPlanResearchRequest,
  captureStudyPlanResearchSnapshot,
  listStudyPlanResearchSnapshots,
  searchStudyPlanWeb,
} from '../../api/study-plan-research';
import {
  discloseResearchQuery,
  RESEARCH_ENDPOINT,
  RESEARCH_MAX_QUERY_CHARS,
  RESEARCH_MAX_RESULTS,
  runBoundedResearch,
} from '../../lib/study-plans/webresearch/researchAdapter';
import type { ExternalSnapshot } from '../../lib/study-plans/webresearch/snapshots';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


interface WebResearchPanelProps {
  planId: string;
  planVersionId: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function createRequestId(): string {
  return `study-research-${globalThis.crypto.randomUUID()}`;
}

export const WebResearchPanel: React.FC<WebResearchPanelProps> = ({ planId, planVersionId }) => {
        useI18n();
        const [query, setQuery] = useState('');
  const [approved, setApproved] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; title: string; url: string; snippet: string }>>([]);
  const [snapshots, setSnapshots] = useState<ExternalSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadSnapshots = useCallback(async () => {
    try {
      setSnapshots(await listStudyPlanResearchSnapshots(planId, planVersionId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load saved source snapshots.');
    }
  }, [planId, planVersionId]);

  useEffect(() => {
    void reloadSnapshots();
  }, [reloadSnapshots]);

  const trimmedQuery = query.trim();
  const canSearch = approved && trimmedQuery.length > 0 && trimmedQuery.length <= RESEARCH_MAX_QUERY_CHARS && !isLoading && !capturingId;
  const handleQueryChange = (value: string) => {
    setQuery(value.slice(0, RESEARCH_MAX_QUERY_CHARS));
    setApproved(false);
    setResults([]);
    setError(null);
    setNotice(null);
  };

  const handleSearch = async () => {
        if (!canSearch) return;
    const requestId = createRequestId();
    setActiveRequestId(requestId);
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await runBoundedResearch(
        { query: trimmedQuery, maxResults: RESEARCH_MAX_RESULTS, budgetUsd: null },
        discloseResearchQuery(trimmedQuery, { approved: true, budgetUsd: null }),
        { searchImpl: ({ query: authorizedQuery }) => searchStudyPlanWeb(authorizedQuery, requestId) }
      );
      setResults(response.items);
      if (response.items.length === 0) setNotice(translateRecentFeature("studyPlans.ui.no-public-results-matched-th.4b8fe3e5"));
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed. Check the connection and try again.');
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const handleCapture = async (
    result: { id: string; title: string; url: string },
    sourceQuery = trimmedQuery
  ) => {
    const requestId = createRequestId();
    setActiveRequestId(requestId);
    setCapturingId(result.id);
    setError(null);
    setNotice(null);
    try {
      const saved = await captureStudyPlanResearchSnapshot({
        planId,
        planVersionId,
        query: sourceQuery,
        url: result.url,
        title: result.title,
        requestId,
      });
      setSnapshots((current) => {
        const updated = current
          .filter((item) => item.id !== saved.id)
          .map((item) => item.url === saved.url && item.status === 'accepted' && item.revisionHash !== saved.revisionHash
            ? { ...item, status: 'stale' as const }
            : item);
        return [saved, ...updated];
      });
      setNotice(saved.status === 'accepted'
        ? 'The page text matches its accepted snapshot; no new revision was needed.'
        : 'Source text was captured as a candidate. Review the saved excerpt before accepting it for questions.');
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Could not capture that page.');
    } finally {
      setCapturingId(null);
      setActiveRequestId(null);
    }
  };

  const handleCancelRequest = async () => {
    if (!activeRequestId) return;
    try {
      await cancelStudyPlanResearchRequest(activeRequestId);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel the Web Research request.');
    }
  };

  const handleAccept = async (snapshot: ExternalSnapshot) => {
        setAcceptingId(snapshot.id);
    setError(null);
    try {
      const accepted = await acceptStudyPlanResearchSnapshot(snapshot.id, planId, planVersionId);
      setSnapshots((current) => current.map((item) => item.id === accepted.id ? accepted : item));
      setNotice(translateRecentFeature("studyPlans.ui.accepted-source-is-now-avail.d4f49445"));
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Could not accept this source.');
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">{translateRecentFeature("studyPlans.ui.web-research.6f6a4f5d")}</h3>
        <p className="text-xs leading-relaxed text-surface-600 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.search-the-public-web-captur.ee94caac")}</p>
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-semibold text-surface-700 dark:text-surface-200" htmlFor="study-plan-web-query">{translateRecentFeature("studyPlans.ui.search-query-var0-var1.8cbf9f65", {var0: trimmedQuery.length, var1: RESEARCH_MAX_QUERY_CHARS})}</label>
        <textarea
          id="study-plan-web-query"
          rows={2}
          maxLength={RESEARCH_MAX_QUERY_CHARS}
          value={query}
          disabled={isLoading || capturingId !== null}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder={translateRecentFeature("studyPlans.ui.enter-the-exact-topic-or-cla.e1115958")}
          className="w-full rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3 text-xs leading-relaxed text-surface-700 dark:text-surface-200">
          <p className="font-semibold">{translateRecentFeature("studyPlans.ui.what-will-happen-when-you-se.2bd444e9")}</p>
        <p className="mt-1">{translateRecentFeature("studyPlans.ui.plethora-sends-this-exact-qu.db38a354")}<span className="break-all">{RESEARCH_ENDPOINT}</span>{translateRecentFeature("studyPlans.ui.it-makes-one-request-allows-.bf0fa838", {var0: RESEARCH_MAX_RESULTS})}</p>
        </div>
        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-surface-700 dark:text-surface-200">
          <input
            type="checkbox"
            checked={approved}
            disabled={isLoading || capturingId !== null}
            onChange={(event) => {
              const next = event.target.checked;
              if (next) setQuery((current) => current.trim());
              setApproved(next);
            }}
            className="mt-0.5 rounded border-surface-400 text-primary-600 focus:ring-primary-500"
            aria-label={translateRecentFeature("studyPlans.ui.approve-sending-this-exact-q.7cebcee9")}
          />
          <span>{translateRecentFeature("studyPlans.ui.i-approve-sending-the-exact-.8eabc212")}</span>
        </label>
        <button
          type="button"
          disabled={!canSearch}
          onClick={() => void handleSearch()}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary-600 px-4 text-xs font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : <MagnifyingGlass className="h-4 w-4" />}
          {isLoading ? translateRecentFeature("studyPlans.ui.searching.d598dfcb") : translateRecentFeature("studyPlans.ui.search-web.aee35e40")}
        </button>
        {isLoading && (
          <button type="button" onClick={() => void handleCancelRequest()} className="ml-2 h-9 rounded-full border border-surface-300 dark:border-surface-600 px-4 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">
            {translateRecentFeature("studyPlans.ui.cancel-search.c1f91a2a")}</button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-surface-600 dark:text-surface-300">
        {translateRecentFeature("studyPlans.ui.capturing-a-selected-result-.3bd92f2a")}</p>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200">
          <WarningCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{translateRecentFeature("studyPlans.ui.var0-you-can-change-the-quer.c05bcee9", {var0: error})}</span>
        </div>
      )}
      {notice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{notice}</p>}

      {results.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-100">{translateRecentFeature("flashcardStudio.contextModeSearchSummary")}</h4>
          {results.map((result) => {
                        return (
            <article key={result.id} className="space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
              <a href={result.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary-700 dark:text-primary-300 underline underline-offset-2">
                {result.title}
              </a>
              <p className="break-all text-[11px] text-surface-600 dark:text-surface-300">{result.url}</p>
              <p className="text-xs leading-relaxed text-surface-700 dark:text-surface-200">{result.snippet || translateRecentFeature("i18nAudit.ui.no-search-snippet-was-suppli.5fe5342a")}</p>
              <button
                type="button"
                onClick={() => void handleCapture(result)}
                disabled={capturingId !== null || isLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50"
              >
                {capturingId === result.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <ArrowSquareOut className="h-3.5 w-3.5" />}
                {capturingId === result.id ? translateRecentFeature("studyPlans.ui.capturing.a99b986b") : translateRecentFeature("studyPlans.ui.capture-source.35f67201")}
              </button>
              {capturingId === result.id && (
                <button type="button" onClick={() => void handleCancelRequest()} className="ml-2 h-8 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">
                  {translateRecentFeature("studyPlans.ui.cancel-capture.52a7c394")}</button>
              )}
            </article>
          );
          })}
        </div>
      )}

      <div className="space-y-3 border-t border-surface-200 dark:border-surface-700 pt-4">
        <div>
          <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-100">{translateRecentFeature("studyPlans.ui.saved-source-snapshots.1bc28622")}</h4>
          <p className="mt-1 text-[11px] text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.candidates-need-your-review-.fa274ed6")}</p>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-xs text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.no-sources-captured-for-this.443f0900")}</p>
        ) : snapshots.map((snapshot) => {
                    return (
          <article key={snapshot.id} className="space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h5 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{snapshot.title}</h5>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${snapshot.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : snapshot.status === 'stale' ? 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                {snapshot.status === 'accepted' ? translateRecentFeature("studyPlans.ui.accepted.32a9ff39") : snapshot.status === 'stale' ? translateRecentFeature("studyPlans.ui.stale.16083edb") : translateRecentFeature("studyPlans.ui.candidate.412fa04d")}
              </span>
            </div>
            <p className="text-[11px] text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.var0-captured-var1-var2.3aabe75a", {var0: snapshot.publisher, var1: formatDate(snapshot.fetchedAt), var2: snapshot.revisionHash})}</p>
            <p className="break-words text-[11px] text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.search-query-var0.c024beb5", {var0: snapshot.query})}</p>
            {snapshot.status === 'stale' && <p className="text-xs text-amber-900 dark:text-amber-200">{translateRecentFeature("studyPlans.ui.the-page-changed-after-this-.fbafb10d")}</p>}
            <blockquote className="rounded-lg bg-surface-50 dark:bg-surface-800/60 p-3 text-xs leading-relaxed text-surface-800 dark:text-surface-100">{snapshot.excerpt}</blockquote>
            <div className="flex flex-wrap items-center gap-3">
              <a href={snapshot.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300 underline underline-offset-2">
                {translateRecentFeature("studyPlans.ui.open-source-page.1bb75ce1")}<ArrowSquareOut className="h-3.5 w-3.5" />
              </a>
              {snapshot.status === 'candidate' ? (
                <button type="button" onClick={() => void handleAccept(snapshot)} disabled={acceptingId !== null} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-200 dark:bg-surface-700 px-3 text-xs font-semibold text-surface-900 dark:text-surface-100 hover:bg-surface-300 dark:hover:bg-surface-600 disabled:opacity-50">
                  {acceptingId === snapshot.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                  {acceptingId === snapshot.id ? translateRecentFeature("studyPlans.ui.accepting.99a801a5") : translateRecentFeature("studyPlans.ui.accept-for-citation.3219213b")}
                </button>
              ) : snapshot.status === 'accepted' ? <span className="text-[11px] text-emerald-800 dark:text-emerald-300">{translateRecentFeature("studyPlans.ui.available-in-assessment-sour.6223fb51")}</span> : null}
              <button
                type="button"
                onClick={() => void handleCapture({ id: snapshot.id, title: snapshot.title, url: snapshot.url }, snapshot.query)}
                disabled={capturingId !== null || isLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50"
              >
                {capturingId === snapshot.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <ArrowSquareOut className="h-3.5 w-3.5" />}
                {capturingId === snapshot.id ? translateRecentFeature("studyPlans.ui.checking.94d897be") : translateRecentFeature("studyPlans.ui.re-check-page.d31d9fe1")}
              </button>
              {capturingId === snapshot.id && <button type="button" onClick={() => void handleCancelRequest()} className="h-8 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">{translateRecentFeature("studyPlans.ui.cancel-check.db74a885")}</button>}
            </div>
          </article>
        );
        })}
      </div>
    </section>
  );
};

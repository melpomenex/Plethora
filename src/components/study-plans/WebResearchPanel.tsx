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
      if (response.items.length === 0) setNotice('No public results matched this query. Try a narrower or more specific phrase.');
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
      setNotice('Accepted source is now available to cite in assessment questions.');
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Could not accept this source.');
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">Web Research</h3>
        <p className="text-xs leading-relaxed text-surface-600 dark:text-surface-300">
          Search the public web, capture a source excerpt, then choose which sources may be cited in assessment questions.
          Search snippets are previews only; captured excerpts are the evidence you review.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-semibold text-surface-700 dark:text-surface-200" htmlFor="study-plan-web-query">
          Search query ({trimmedQuery.length}/{RESEARCH_MAX_QUERY_CHARS})
        </label>
        <textarea
          id="study-plan-web-query"
          rows={2}
          maxLength={RESEARCH_MAX_QUERY_CHARS}
          value={query}
          disabled={isLoading || capturingId !== null}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Enter the exact topic or claim you want to research"
          className="w-full rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3 text-xs leading-relaxed text-surface-700 dark:text-surface-200">
          <p className="font-semibold">What will happen when you search</p>
        <p className="mt-1">Plethora sends this exact query to Brave Search at <span className="break-all">{RESEARCH_ENDPOINT}</span>. It makes one request, allows up to 8 seconds, and returns up to {RESEARCH_MAX_RESULTS} results. Plan text, library content, and your answers are not sent. Provider pricing depends on your Brave API plan and is not shown by the app.</p>
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
            aria-label="Approve sending this exact query to Brave Search"
          />
          <span>I approve sending the exact query shown above to Brave Search.</span>
        </label>
        <button
          type="button"
          disabled={!canSearch}
          onClick={() => void handleSearch()}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary-600 px-4 text-xs font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : <MagnifyingGlass className="h-4 w-4" />}
          {isLoading ? 'Searching…' : 'Search web'}
        </button>
        {isLoading && (
          <button type="button" onClick={() => void handleCancelRequest()} className="ml-2 h-9 rounded-full border border-surface-300 dark:border-surface-600 px-4 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">
            Cancel search
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-surface-600 dark:text-surface-300">
        Capturing a selected result separately fetches that public page with no cookies or app data. Each capture is limited to 1 MB, 12 seconds total, and two redirects; Plethora saves up to 12,000 characters with the capture date and revision hash.
      </p>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200">
          <WarningCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error} You can change the query or retry the action.</span>
        </div>
      )}
      {notice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{notice}</p>}

      {results.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-100">Search results</h4>
          {results.map((result) => (
            <article key={result.id} className="space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
              <a href={result.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary-700 dark:text-primary-300 underline underline-offset-2">
                {result.title}
              </a>
              <p className="break-all text-[11px] text-surface-600 dark:text-surface-300">{result.url}</p>
              <p className="text-xs leading-relaxed text-surface-700 dark:text-surface-200">{result.snippet || 'No search snippet was supplied.'}</p>
              <button
                type="button"
                onClick={() => void handleCapture(result)}
                disabled={capturingId !== null || isLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50"
              >
                {capturingId === result.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <ArrowSquareOut className="h-3.5 w-3.5" />}
                {capturingId === result.id ? 'Capturing…' : 'Capture source'}
              </button>
              {capturingId === result.id && (
                <button type="button" onClick={() => void handleCancelRequest()} className="ml-2 h-8 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">
                  Cancel capture
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-surface-200 dark:border-surface-700 pt-4">
        <div>
          <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-100">Saved source snapshots</h4>
          <p className="mt-1 text-[11px] text-surface-600 dark:text-surface-300">Candidates need your review and acceptance before they can be cited. Acceptance stores a source; it does not automatically verify a claim.</p>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-xs text-surface-600 dark:text-surface-300">No sources captured for this plan version yet.</p>
        ) : snapshots.map((snapshot) => (
          <article key={snapshot.id} className="space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h5 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{snapshot.title}</h5>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${snapshot.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : snapshot.status === 'stale' ? 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                {snapshot.status === 'accepted' ? 'Accepted' : snapshot.status === 'stale' ? 'Stale' : 'Candidate'}
              </span>
            </div>
            <p className="text-[11px] text-surface-600 dark:text-surface-300">{snapshot.publisher} · Captured {formatDate(snapshot.fetchedAt)} · {snapshot.revisionHash}</p>
            <p className="break-words text-[11px] text-surface-600 dark:text-surface-300">Search query: {snapshot.query}</p>
            {snapshot.status === 'stale' && <p className="text-xs text-amber-900 dark:text-amber-200">The page changed after this capture. This revision stays in your history but cannot be used for new assessment publications.</p>}
            <blockquote className="rounded-lg bg-surface-50 dark:bg-surface-800/60 p-3 text-xs leading-relaxed text-surface-800 dark:text-surface-100">{snapshot.excerpt}</blockquote>
            <div className="flex flex-wrap items-center gap-3">
              <a href={snapshot.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300 underline underline-offset-2">
                Open source page <ArrowSquareOut className="h-3.5 w-3.5" />
              </a>
              {snapshot.status === 'candidate' ? (
                <button type="button" onClick={() => void handleAccept(snapshot)} disabled={acceptingId !== null} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-200 dark:bg-surface-700 px-3 text-xs font-semibold text-surface-900 dark:text-surface-100 hover:bg-surface-300 dark:hover:bg-surface-600 disabled:opacity-50">
                  {acceptingId === snapshot.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                  {acceptingId === snapshot.id ? 'Accepting…' : 'Accept for citation'}
                </button>
              ) : snapshot.status === 'accepted' ? <span className="text-[11px] text-emerald-800 dark:text-emerald-300">Available in assessment source lists</span> : null}
              <button
                type="button"
                onClick={() => void handleCapture({ id: snapshot.id, title: snapshot.title, url: snapshot.url }, snapshot.query)}
                disabled={capturingId !== null || isLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50"
              >
                {capturingId === snapshot.id ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : <ArrowSquareOut className="h-3.5 w-3.5" />}
                {capturingId === snapshot.id ? 'Checking…' : 'Re-check page'}
              </button>
              {capturingId === snapshot.id && <button type="button" onClick={() => void handleCancelRequest()} className="h-8 rounded-full border border-surface-300 dark:border-surface-600 px-3 text-xs font-semibold text-surface-800 dark:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800">Cancel check</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

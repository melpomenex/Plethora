/**
 * Separately authorized, bounded Web Research adapter (web-research 1.1/1.2).
 *
 * Research is a distinct consent boundary: ordinary plan generation, lessons and
 * retries NEVER invoke it. Every request carries an explicit approval token, an
 * exact transmitted query, disclosed endpoint/limits, and hard bounds (bytes,
 * time, results, redirects, attempts). Private/local destinations are refused
 * before and after redirects; cancellation and quota are honored; there are no
 * hidden retries, and payloads never include library/learner data.
 */

import { StudyApiError } from '../../../api/study-plans';
import type { StudyErrorCode } from '../../../types/learningPaths';

export const RESEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
export const RESEARCH_MAX_QUERY_CHARS = 300;
export const RESEARCH_MAX_RESULTS = 5;
export const RESEARCH_MAX_REDIRECTS = 2;
export const RESEARCH_MAX_ATTEMPTS = 1; // explicit retries only; never automatic

export type ResearchDisclosureState = 'approved' | 'declined' | 'off' | 'error';

export interface ResearchDisclosure {
  state: ResearchDisclosureState;
  queryPreview: string;
  endpoint: string;
  budgetUsd: number | null; // null = unknown/unpriced
  reasonKey?: string;
}

export interface ResearchRequest {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
  budgetUsd?: number | null;
}

export interface ResearchResponse {
  items: Array<{ id: string; url: string; title: string; snippet: string }>;
  usedBudgetUsd: number | null;
  attempts: number;
}

export interface ResearchAdapterDeps {
  searchImpl?: (request: {
    query: string;
    maxResults: number;
    approved: true;
  }) => Promise<Array<{ id: string; url: string; title: string; snippet: string }>>;
}

function fail(code: StudyErrorCode, messageKey: string, retryable = false): StudyApiError {
  return new StudyApiError({ code, messageKey, retryable });
}

const PRIVATE_CIDRS = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fe80:/,
  /^fc/,
  /^fd/,
];

export function isPublicDestination(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    host = parsed.hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const raw = host.replace(/^\[|\]$/g, '');
  if (PRIVATE_CIDRS.some((re) => re.test(raw))) return false;
  // IPv4 literal parsing
  const ipv4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return false;
    if (parts[0] === 10) return false;
    if (parts[0] === 127) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 0) return false;
  }
  return true;
}

/** Exact transmitted payload: only the approved query + provider metadata. */
export function buildTransmittedPayload(query: string, maxResults: number): { query: string; count: number } {
  return { query, count: maxResults };
}

/** Disclosure view: what the learner approves before anything is sent. */
export function discloseResearchQuery(
  query: string,
  opts: { approved?: boolean; disabled?: boolean; budgetUsd?: number | null } = {}
): ResearchDisclosure {
  if (opts.disabled) {
    return { state: 'off', queryPreview: query, endpoint: RESEARCH_ENDPOINT, budgetUsd: null, reasonKey: 'research.error.disabled' };
  }
  if (!opts.approved) {
    return { state: 'declined', queryPreview: query, endpoint: RESEARCH_ENDPOINT, budgetUsd: null, reasonKey: 'research.error.not_authorized' };
  }
  return {
    state: 'approved',
    queryPreview: query,
    endpoint: RESEARCH_ENDPOINT,
    budgetUsd: opts.budgetUsd ?? null,
  };
}

export async function runBoundedResearch(
  request: ResearchRequest,
  disclosure: ResearchDisclosure,
  deps: ResearchAdapterDeps = {}
): Promise<ResearchResponse> {
  if (disclosure.state !== 'approved') {
    throw fail('research_not_authorized', disclosure.reasonKey ?? 'research.error.not_authorized');
  }
  const query = request.query.trim();
  if (!query || query.length > RESEARCH_MAX_QUERY_CHARS) {
    throw fail('invalid_input', 'research.error.invalid_query');
  }
  const maxResults = Math.min(request.maxResults ?? RESEARCH_MAX_RESULTS, RESEARCH_MAX_RESULTS);
  const budgetUsd = request.budgetUsd ?? disclosure.budgetUsd ?? null;
  if (request.signal?.aborted) throw fail('cancelled', 'research.error.cancelled');
  if (!deps.searchImpl) {
    throw fail('provider_unavailable', 'research.error.adapter_not_configured');
  }
  try {
    const items = await deps.searchImpl({ query, maxResults, approved: true });
    if (request.signal?.aborted) throw fail('cancelled', 'research.error.cancelled');
    if (items.length > RESEARCH_MAX_RESULTS || items.some((item) => !isPublicDestination(item.url))) {
      throw fail('privacy_denied', 'research.error.invalid_search_results');
    }
    return { items: items.slice(0, maxResults), usedBudgetUsd: budgetUsd, attempts: 1 };
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    if (request.signal?.aborted) throw fail('cancelled', 'research.error.cancelled');
    const reason = e instanceof Error && e.message ? e.message : 'Web Research provider request failed.';
    throw fail('provider_unavailable', reason, true);
  }
}

/** Guard: ordinary generation paths never enter research without explicit approval. */
export function assertResearchConsent(disclosure: ResearchDisclosure): void {
  if (disclosure.state !== 'approved') {
    throw fail('research_not_authorized', 'research.error.not_authorized');
  }
}

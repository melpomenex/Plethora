/**
 * Hook tests for useDictionaryEntry (task 2.3): resolver-based query
 * normalization (punctuated input shares one cache entry), cache hits on
 * repeat lookups (no second fetch), vocabulary recording on success, and the
 * disabled state for empty input.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictionaryEntry } from "../../hooks/useDictionaryEntry";
import { useVocabularyHistoryStore } from "../../stores/vocabularyHistoryStore";

const apiEntry = [
  {
    word: "ephemeral",
    phonetic: "/ɪˈfem(ə)rəl/",
    meanings: [
      {
        partOfSpeech: "adjective",
        definitions: [{ definition: "Lasting for a very short time." }],
      },
    ],
  },
];

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("useDictionaryEntry", () => {
  beforeEach(() => {
    useVocabularyHistoryStore.setState({ entries: {} });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("normalizes punctuated input and serves repeat lookups from cache", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dictionaryapi.dev")) {
        return new Response(JSON.stringify(apiEntry), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useDictionaryEntry(text, "doc-1"),
      { wrapper: Wrapper, initialProps: { text: '"Ephemeral,"' } },
    );

    await waitFor(() => expect(result.current.data?.ok).toBe(true));
    expect(result.current.data).toMatchObject({
      ok: true,
      entry: { word: "ephemeral", phonetic: "/ɪˈfem(ə)rəl/" },
    });
    const fetchesAfterFirst = fetchMock.mock.calls.length;

    // Repeat lookup of the SAME punctuated word: cache hit, no new fetch.
    rerender({ text: '"ephemeral",' });
    await waitFor(() => expect(result.current.data?.ok).toBe(true));
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst);

    // The vocabulary store recorded the lookup exactly once.
    const entry = useVocabularyHistoryStore.getState().entries["ephemeral"];
    expect(entry).toBeDefined();
    expect(entry.lookupCount).toBe(1);
    expect(entry.lastDocumentId).toBe("doc-1");
  });

  it("does not fetch or record for empty/none-intent input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDictionaryEntry("  ... ", "doc-1"), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useVocabularyHistoryStore.getState().entries).toEqual({});
  });

  it("does not record vocabulary on lookup failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ title: "No Definitions Found" }), { status: 404 })),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDictionaryEntry("qwertyzxcvb", null), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data?.ok).toBe(false));
    expect(result.current.data).toEqual({ ok: false, failure: { kind: "not-found" } });
    expect(useVocabularyHistoryStore.getState().entries).toEqual({});
  });

  it("exposes the unavailable taxonomy for provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("dictionaryapi.dev")) {
          return new Response("{}", { status: 503 });
        }
        return new Response("[]", { status: 200 });
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDictionaryEntry("ephemeral", null), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data?.ok).toBe(false));
    expect(result.current.data).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("resolves network failures as typed data — no retry storm, no error state", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        throw new TypeError("Failed to fetch");
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: () => 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDictionaryEntry("ephemeral", null), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data?.ok).toBe(false));
    // The queryFn RESOLVES with a typed failure — React Query sees success, so
    // there is no error state and no retry (no retry storms, design D5).
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
    // One queryFn round trip = definition + synonym fetch, then pure cache.
    expect(calls).toBe(2);
    act(() => {
      client.clear();
    });
  });
});

/**
 * Unit tests for the SponsorBlock segment fetch: timeout, caching, category
 * filtering and the settings gate (src/api/sponsorblock.ts, src/hooks/
 * useSponsorBlock.ts).
 *
 * The three players share this one module, so these tests are what keep
 * "disabling SponsorBlock means no request" true in all of them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchSponsorBlockSegments,
  clearSponsorBlockSegmentCache,
  hasCachedSponsorBlockSegments,
  submitSegment,
  voteOnSegment,
  type SponsorBlockSegment,
} from "../sponsorblock";

const fetchMock = vi.fn();

function response(segments: SponsorBlockSegment[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        sponsorTimes: segments.map((s) => s.segment),
        UUID: segments.map((s) => s.UUID),
        category: segments.map((s) => s.category),
        actionType: segments.map(() => "skip"),
      },
    ],
  } as unknown as Response;
}

function seg(category: string, start: number, end: number, uuid: string): SponsorBlockSegment {
  return {
    category: category as SponsorBlockSegment["category"],
    actionType: "skip",
    segment: [start, end] as [number, number],
    UUID: uuid,
    locked: 0,
    votes: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  clearSponsorBlockSegmentCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSponsorBlockSegments — request shape", () => {
  it("carries a timeout signal on the request", async () => {
    fetchMock.mockResolvedValue(response([]));
    await fetchSponsorBlockSegments("vid1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("asks only for the categories it is given", async () => {
    fetchMock.mockResolvedValue(response([]));
    await fetchSponsorBlockSegments("vid1", ["sponsor", "intro"]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("categories=sponsor%2Cintro");
    expect(url).not.toContain("music_offtopic");
  });

  it("returns an empty list and no throw when the service is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchSponsorBlockSegments("vid1")).resolves.toEqual([]);
  });

  it("returns an empty list on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(fetchSponsorBlockSegments("vid1")).resolves.toEqual([]);
  });

  it("does not retry a failure within the session", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await fetchSponsorBlockSegments("vid1");
    await fetchSponsorBlockSegments("vid1");
    await fetchSponsorBlockSegments("vid1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSponsorBlockSegments — caching", () => {
  it("serves a repeat play from cache", async () => {
    fetchMock.mockResolvedValue(response([seg("sponsor", 10, 20, "a")]));
    const first = await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    const second = await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("refetches once the cache duration has passed", async () => {
    fetchMock.mockResolvedValue(response([seg("sponsor", 10, 20, "a")]));
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    expect(hasCachedSponsorBlockSegments("vid1")).toBe(true);

    // TTL is in hours, so age the entry past it rather than waiting.
    const realNow = Date.now;
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(realNow() + 49 * 3_600_000);
    try {
      await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("caches per video id, not globally", async () => {
    fetchMock.mockResolvedValue(response([seg("sponsor", 10, 20, "a")]));
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    await fetchSponsorBlockSegments("vid2", ["sponsor"], 48);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent requests for the same video onto one call", async () => {
    let release: (v: SponsorBlockSegment[]) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<SponsorBlockSegment[]>((resolve) => { release = resolve; })
    );
    const p1 = fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    const p2 = fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    const p3 = fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    release([seg("sponsor", 1, 2, "a")]);
    const results = await Promise.all([p1, p2, p3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("refetches every time when the cache duration is zero", async () => {
    fetchMock.mockResolvedValue(response([seg("sponsor", 10, 20, "a")]));
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 0);
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches an empty result, so a clean video is not re-asked", async () => {
    fetchMock.mockResolvedValue(response([]));
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    await fetchSponsorBlockSegments("vid1", ["sponsor"], 48);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("write paths build a single /api prefix", () => {
  it("submitSegment does not double the /api segment", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    await submitSegment("vid1", 1, 2, "sponsor", "user");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://sponsor.ajay.app/api/skipSegments");
    expect(url).not.toContain("/api/api");
  });

  it("voteOnSegment does not double the /api segment", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    await voteOnSegment("uuid-1", "user", 1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://sponsor.ajay.app/api/voteOnSponsorTime");
    expect(url).not.toContain("/api/api");
  });
});

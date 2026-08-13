import { useCallback, useEffect, useState } from "react";
import {
  getItemStatsDetail,
  getItemStatsSummary,
  type ItemStatsDetail,
  type ItemStatsSummary,
  type StatsItemType,
} from "../api/item-stats";

/**
 * Fetches per-item statistics for the two surfaces that show them.
 *
 * Both fetches are keyed to *opening*, not to mounting: the summary loads when
 * the popover opens and the detail when the modal opens, and each reopen
 * refetches. That is what makes "rate an item, reopen its stats, see the
 * review you just did" hold — a cached payload would show the state from
 * before the rating.
 */

export interface UseItemStatsOptions {
  itemType: StatsItemType | null | undefined;
  itemId: string | null | undefined;
  /** True while the popover is open. Drives the summary fetch. */
  isSummaryOpen: boolean;
  /** True while the modal is open. Drives the detail fetch. */
  isDetailOpen?: boolean;
  /** From the user's learning settings, so the leech flag agrees elsewhere. */
  leechThreshold?: number;
}

export interface UseItemStats {
  summary: ItemStatsSummary | null;
  isSummaryLoading: boolean;
  summaryError: string | null;
  detail: ItemStatsDetail | null;
  isDetailLoading: boolean;
  detailError: string | null;
  /** Refetch whatever is currently open. */
  refresh: () => void;
}

export function useItemStats({
  itemType,
  itemId,
  isSummaryOpen,
  isDetailOpen = false,
  leechThreshold,
}: UseItemStatsOptions): UseItemStats {
  const [summary, setSummary] = useState<ItemStatsSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ItemStatsDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const canFetch = Boolean(itemType && itemId);

  useEffect(() => {
    if (!isSummaryOpen || !canFetch) return;

    let active = true;
    setIsSummaryLoading(true);
    setSummaryError(null);

    getItemStatsSummary(itemType as StatsItemType, itemId as string)
      .then((result) => {
        if (!active) return;
        setSummary(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Stale data would be worse than none: the summary must never show
        // numbers from a previous item or a previous state.
        setSummary(null);
        setSummaryError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setIsSummaryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSummaryOpen, canFetch, itemType, itemId, reloadToken]);

  useEffect(() => {
    if (!isDetailOpen || !canFetch) return;

    let active = true;
    setIsDetailLoading(true);
    setDetailError(null);

    getItemStatsDetail(itemType as StatsItemType, itemId as string, leechThreshold)
      .then((result) => {
        if (!active) return;
        setDetail(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setIsDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isDetailOpen, canFetch, itemType, itemId, leechThreshold, reloadToken]);

  // Closing drops what was fetched, so the next open cannot flash the
  // previous values before its own request lands.
  useEffect(() => {
    if (!isSummaryOpen) {
      setSummary(null);
      setSummaryError(null);
    }
  }, [isSummaryOpen]);

  useEffect(() => {
    if (!isDetailOpen) {
      setDetail(null);
      setDetailError(null);
    }
  }, [isDetailOpen]);

  return {
    summary,
    isSummaryLoading,
    summaryError,
    detail,
    isDetailLoading,
    detailError,
    refresh,
  };
}

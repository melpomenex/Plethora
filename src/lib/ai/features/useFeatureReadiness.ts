/**
 * React binding over the shared readiness probe cache (F0 task 1.3).
 *
 * - One probe per configuration revision, deduplicated across mounted
 *   consumers (the cache lives in `probe.ts`).
 * - The previous verdict is retained while a new probe is in flight, but it is
 *   marked `checking` — never rendered as an optimistic green.
 * - A superseded probe cannot update a newer snapshot: the effect compares the
 *   snapshot revision with the current revision before committing.
 * - Unmount aborts the consumer subscription; the shared cache stays warm so
 *   Settings search/reveal does not re-probe on every keystroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { evaluateFeatureReadiness } from "./registry";
import {
  buildFeatureDependencyContext,
  computeDependencyRevision,
  getFeatureDependencyContext,
  invalidateFeatureReadiness,
} from "./probe";
import type { FeatureDependencyContext, FeatureId, FeatureReadiness } from "./types";

export interface FeatureReadinessState {
  rows: readonly FeatureReadiness[];
  context: FeatureDependencyContext | null;
  loading: boolean;
  /** Null until the first successful probe. */
  checkedAt: number | null;
  revision: string;
  refresh: () => void;
}

export function useFeatureReadiness(featureId?: FeatureId): FeatureReadinessState {
  const settings = useSettingsStore((s) => s.settings);
  const providers = useLLMProvidersStore((s) => s.providers);
  const revision = useMemo(
    () => computeDependencyRevision(settings, providers),
    [settings, providers]
  );

  const [context, setContext] = useState<FeatureDependencyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void getFeatureDependencyContext(revision, () =>
      buildFeatureDependencyContext({ checking: false })
    )
      .then((snapshot) => {
        // A late probe for an older revision never becomes the current state:
        // readiness for the replacement configuration is re-evaluated.
        if (!cancelled && mounted.current && snapshot.revision === revision) {
          setContext(snapshot);
        }
      })
      .catch(() => {
        // Probe failure is `unknown`, not an exception storm. Keep the last
        // verdict (marked checking) and let the caller render recovery.
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [revision, refreshToken]);

  const refresh = useCallback(() => {
    invalidateFeatureReadiness();
    setRefreshToken((value) => value + 1);
  }, []);

  const rows = useMemo(() => {
    if (!context) return [];
    const evaluated = evaluateFeatureReadiness(context);
    // While a new revision is probed, the previous verdict is retained for
    // context but marked checking so the UI cannot render an optimistic green.
    return loading
      ? evaluated.map((row) => ({ ...row, checking: true }))
      : evaluated;
  }, [context, loading]);

  const filtered = useMemo(
    () => (featureId ? rows.filter((row) => row.featureId === featureId) : rows),
    [rows, featureId]
  );

  return {
    rows: filtered,
    context,
    loading,
    checkedAt: context?.checkedAt ?? null,
    revision,
    refresh,
  };
}

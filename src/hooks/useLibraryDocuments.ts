import { useCallback, useEffect, useRef, useState } from "react";
import { getDocuments } from "../api/documents";
import type { Document } from "../types/document";
import type { CaptureListingSource } from "../api/capture-activity";

/** All-library views own their summaries, so they cannot overwrite another collection's cache. */
export function useLibraryDocuments(enabled: boolean, source: CaptureListingSource | undefined, isActive: boolean) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [hasCompletedFirstLoad, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getDocuments(undefined, source);
      if (request === generation.current) { setDocuments(next); setCompleted(true); }
    } catch (error) {
      if (request === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [enabled, source]);
  useEffect(() => {
    if (enabled && isActive) void reload();
    return () => { generation.current++; };
  }, [enabled, isActive, reload]);
  const patch = useCallback((id: string, updates: Partial<Document>) => {
    setDocuments(current => current.map(doc => doc.id === id ? { ...doc, ...updates } : doc));
  }, []);
  return { documents, isLoading, hasCompletedFirstLoad, error, reload, patch };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { getCaptureDocuments, getCaptureListingSource, getCaptureActivity, type CaptureListingSource } from "../api/capture-activity";
import { isTauri, listen } from "../lib/tauri";
import { CAPTURE_INVALIDATION_EVENT, type CaptureInvalidation } from "../lib/captureInvalidation";

const loadActivity = () => getCaptureActivity(30);

/** Independent query state with stale-content retention and obsolete-response protection. */
function useCaptureQuery<T>(fetchData: () => Promise<T>, isActive: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(isActive);
  active.current = isActive;
  const reload = useCallback(async () => {
    if (!active.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchData();
      if (active.current && request === generation.current) setData(result);
    } catch (error) {
      if (active.current && request === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [fetchData]);
  useEffect(() => {
    active.current = isActive;
    generation.current++;
    return () => { generation.current++; active.current = false; };
  }, [fetchData, isActive]);
  return { data, isLoading, error, reload };
}

export function useCaptureActivity(isActive: boolean, source: CaptureListingSource = getCaptureListingSource()) {
  const loadCaptures = useCallback(() => getCaptureDocuments(source, 6), [source]);
  const activity = useCaptureQuery(loadActivity, isActive);
  const captures = useCaptureQuery(loadCaptures, isActive);
  const reload = useCallback(() => {
    void activity.reload();
    void captures.reload();
  }, [activity.reload, captures.reload]);

  useEffect(() => {
    if (!isActive) return;
    reload();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    const scheduleReload = () => {
      if (disposed) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 500);
    };
    const onCaptureInvalidated = (event: Event) => {
      const detail = (event as CustomEvent<CaptureInvalidation>).detail;
      if (detail?.source === source) scheduleReload();
    };
    window.addEventListener(CAPTURE_INVALIDATION_EVENT, onCaptureInvalidated);
    if (isTauri() && source === "browser-extension") {
      void listen("browser-sync://document-saved", scheduleReload).then(stop => {
        if (disposed) stop(); else unlisten = stop;
      }).catch(() => {
        // Activation refresh remains available if native event registration fails.
      });
    }
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
      window.removeEventListener(CAPTURE_INVALIDATION_EVENT, onCaptureInvalidated);
    };
  }, [isActive, reload, source]);
  return { activity, captures, browserSaves: captures, reload };
}

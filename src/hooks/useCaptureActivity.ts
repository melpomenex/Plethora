import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserCaptureDocuments, getCaptureActivity } from "../api/capture-activity";
import { isTauri, listen } from "../lib/tauri";

const loadActivity = () => getCaptureActivity(30);
const loadBrowserSaves = () => getBrowserCaptureDocuments(6);

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
    return () => { generation.current++; active.current = false; };
  }, [isActive]);
  return { data, isLoading, error, reload };
}

export function useCaptureActivity(isActive: boolean) {
  const activity = useCaptureQuery(loadActivity, isActive);
  const browserSaves = useCaptureQuery(loadBrowserSaves, isActive);
  const reload = useCallback(() => {
    void activity.reload();
    void browserSaves.reload();
  }, [activity.reload, browserSaves.reload]);

  useEffect(() => {
    if (!isActive) return;
    reload();
    if (!isTauri()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    void listen("browser-sync://document-saved", () => {
      if (disposed) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 500);
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {
      // Activation refresh remains available if native event registration fails.
    });
    return () => { disposed = true; clearTimeout(timer); unlisten?.(); };
  }, [isActive, reload]);
  return { activity, browserSaves, reload };
}

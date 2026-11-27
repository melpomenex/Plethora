import { useCallback, useEffect, useRef, useState } from "react";
import { isCancelledError } from "../../ai/errors";

export type StudyTaskStatus = "idle" | "running" | "streaming" | "error" | "cancelled";

export interface StudyTaskState {
  status: StudyTaskStatus;
  streamPreview: string;
  error: string | null;
  startedAt: number | null;
}

export interface StudyTaskExecutionContext {
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
}

export type StudyTaskOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; cancelled: boolean; error: string; rawError?: unknown };

export function isStudyTaskSuccess<T>(
  outcome: StudyTaskOutcome<T>
): outcome is { ok: true; value: T } {
  return outcome.ok === true;
}

export interface UseStudyTaskControllerResult {
  tasks: Record<string, StudyTaskState>;
  isTaskRunning: (taskKey: string) => boolean;
  getTaskState: (taskKey: string) => StudyTaskState;
  runControlledTask: <T>(
    taskKey: string,
    executor: (ctx: StudyTaskExecutionContext) => Promise<T>
  ) => Promise<StudyTaskOutcome<T>>;
  cancelTask: (taskKey: string) => void;
  cancelAllTasks: () => void;
  clearTaskError: (taskKey: string) => void;
}

const IDLE_STATE: StudyTaskState = {
  status: "idle",
  streamPreview: "",
  error: null,
  startedAt: null,
};

/**
 * Manages independent, AbortController-backed AI generation tasks with
 * streaming preview support so users can run, cancel, and switch tools concurrently.
 */
export function useStudyTaskController(): UseStudyTaskControllerResult {
  const [tasks, setTasks] = useState<Record<string, StudyTaskState>>({});
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const cancelTask = useCallback((taskKey: string) => {
    const ctrl = controllersRef.current.get(taskKey);
    if (ctrl) {
      ctrl.abort();
      controllersRef.current.delete(taskKey);
    }
    setTasks((prev) => ({
      ...prev,
      [taskKey]: {
        status: "cancelled",
        streamPreview: "",
        error: null,
        startedAt: null,
      },
    }));
  }, []);

  const cancelAllTasks = useCallback(() => {
    for (const ctrl of controllersRef.current.values()) {
      ctrl.abort();
    }
    controllersRef.current.clear();
  }, []);

  const clearTaskError = useCallback((taskKey: string) => {
    setTasks((prev) => {
      const current = prev[taskKey];
      if (!current) return prev;
      return {
        ...prev,
        [taskKey]: { ...current, status: "idle", error: null },
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const ctrl of controllersRef.current.values()) {
        ctrl.abort();
      }
      controllersRef.current.clear();
    };
  }, []);

  const runControlledTask = useCallback(
    async <T,>(
      taskKey: string,
      executor: (ctx: StudyTaskExecutionContext) => Promise<T>
    ): Promise<StudyTaskOutcome<T>> => {
      // Abort only any prior run of the same taskKey
      const existing = controllersRef.current.get(taskKey);
      if (existing) {
        existing.abort();
      }

      const controller = new AbortController();
      controllersRef.current.set(taskKey, controller);

      setTasks((prev) => ({
        ...prev,
        [taskKey]: {
          status: "running",
          streamPreview: "",
          error: null,
          startedAt: Date.now(),
        },
      }));

      const onChunk = (chunk: string) => {
        if (controller.signal.aborted) return;
        setTasks((prev) => {
          const cur = prev[taskKey] ?? IDLE_STATE;
          return {
            ...prev,
            [taskKey]: {
              ...cur,
              status: "streaming",
              streamPreview: (cur.streamPreview + chunk).slice(-600),
            },
          };
        });
      };

      try {
        const value = await executor({ signal: controller.signal, onChunk });
        if (controller.signal.aborted) {
          return { ok: false, cancelled: true, error: "Cancelled" };
        }
        if (controllersRef.current.get(taskKey) === controller) {
          controllersRef.current.delete(taskKey);
        }
        setTasks((prev) => ({
          ...prev,
          [taskKey]: { ...IDLE_STATE },
        }));
        return { ok: true, value };
      } catch (err) {
        if (controllersRef.current.get(taskKey) === controller) {
          controllersRef.current.delete(taskKey);
        }
        if (controller.signal.aborted || isCancelledError(err)) {
          setTasks((prev) => ({
            ...prev,
            [taskKey]: {
              status: "cancelled",
              streamPreview: "",
              error: null,
              startedAt: null,
            },
          }));
          return { ok: false, cancelled: true, error: "Cancelled" };
        }
        const message =
          err instanceof Error
            ? err.message
            : "Task failed. Check provider availability or inspect the original source.";
        setTasks((prev) => ({
          ...prev,
          [taskKey]: {
            status: "error",
            streamPreview: "",
            error: message,
            startedAt: null,
          },
        }));
        return { ok: false, cancelled: false, error: message, rawError: err };
      }
    },
    []
  );

  const getTaskState = useCallback(
    (taskKey: string): StudyTaskState => tasks[taskKey] ?? IDLE_STATE,
    [tasks]
  );

  const isTaskRunning = useCallback(
    (taskKey: string): boolean => {
      const s = tasks[taskKey]?.status;
      return s === "running" || s === "streaming";
    },
    [tasks]
  );

  return {
    tasks,
    isTaskRunning,
    getTaskState,
    runControlledTask,
    cancelTask,
    cancelAllTasks,
    clearTaskError,
  };
}

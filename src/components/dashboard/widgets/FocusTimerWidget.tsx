import { useCallback, useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  Brain,
  Coffee,
  Pause,
  Play,
  SkipForward,
  SunDim,
  Timer,
} from "@phosphor-icons/react";
import {
  getFocusTimerState,
  pauseFocusTimer,
  resetFocusTimer,
  skipFocusTimerPhase,
  startFocusTimer,
} from "../../../api/focusTimer";
import {
  DEFAULT_TIMER_CONFIG,
  type FocusTimerState,
  type TimerPhase,
} from "../../../types/focus-timer";
import { cn } from "../../../utils/cn";

const FALLBACK_INITIAL_STATE: FocusTimerState = {
  state: "idle",
  phase: "work",
  remaining_seconds: DEFAULT_TIMER_CONFIG.work_duration * 60,
  total_seconds: DEFAULT_TIMER_CONFIG.work_duration * 60,
  completed_sessions: 0,
  total_focus_time: 0,
  config: DEFAULT_TIMER_CONFIG,
};

function formatTimerClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getNextPhase(phase: TimerPhase, completedSessions: number, sessionsBeforeLong: number): TimerPhase {
  if (phase === "work") {
    return (completedSessions + 1) % Math.max(1, sessionsBeforeLong) === 0 ? "longbreak" : "shortbreak";
  }
  return "work";
}

function getPhaseDurationSeconds(phase: TimerPhase, state: FocusTimerState): number {
  if (phase === "shortbreak") return state.config.short_break_duration * 60;
  if (phase === "longbreak") return state.config.long_break_duration * 60;
  return state.config.work_duration * 60;
}

const PHASE_META: Record<TimerPhase, { label: string; badgeClass: string; stroke: string; icon: typeof Brain }> = {
  work: {
    label: "Focus",
    badgeClass: "bg-primary/10 text-primary",
    stroke: "stroke-primary",
    icon: Brain,
  },
  shortbreak: {
    label: "Short Break",
    badgeClass: "bg-emerald-500/10 text-emerald-500",
    stroke: "stroke-emerald-500",
    icon: Coffee,
  },
  longbreak: {
    label: "Long Break",
    badgeClass: "bg-amber-500/10 text-amber-500",
    stroke: "stroke-amber-500",
    icon: SunDim,
  },
};

export function FocusTimerWidget() {
  const [timer, setTimer] = useState<FocusTimerState>(FALLBACK_INITIAL_STATE);
  const [backendAvailable, setBackendAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getFocusTimerState()
      .then((next) => {
        if (!cancelled && next) {
          setTimer(next);
          setBackendAvailable(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendAvailable(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (timer.state !== "running") return;
    const id = window.setInterval(() => {
      setTimer((prev) => {
        if (prev.state !== "running") return prev;
        if (prev.remaining_seconds <= 1) {
          const nextCompleted = prev.phase === "work" ? prev.completed_sessions + 1 : prev.completed_sessions;
          const nextPhase = getNextPhase(prev.phase, prev.completed_sessions, prev.config.sessions_before_long_break);
          const nextTotal = getPhaseDurationSeconds(nextPhase, prev);
          return {
            ...prev,
            state: "idle",
            phase: nextPhase,
            remaining_seconds: nextTotal,
            total_seconds: nextTotal,
            completed_sessions: nextCompleted,
            total_focus_time: prev.phase === "work" ? prev.total_focus_time + prev.total_seconds : prev.total_focus_time,
          };
        }
        return {
          ...prev,
          remaining_seconds: prev.remaining_seconds - 1,
        };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timer.state]);

  const handleTogglePlay = useCallback(async () => {
    const isRunning = timer.state === "running";
    if (backendAvailable) {
      try {
        const next = isRunning ? await pauseFocusTimer() : await startFocusTimer();
        if (next) {
          setTimer(next);
          return;
        }
      } catch {
        setBackendAvailable(false);
      }
    }
    setTimer((prev) => ({
      ...prev,
      state: prev.state === "running" ? "paused" : "running",
    }));
  }, [backendAvailable, timer.state]);

  const handleReset = useCallback(async () => {
    if (backendAvailable) {
      try {
        const next = await resetFocusTimer();
        if (next) {
          setTimer(next);
          return;
        }
      } catch {
        setBackendAvailable(false);
      }
    }
    setTimer((prev) => {
      const total = getPhaseDurationSeconds(prev.phase, prev);
      return {
        ...prev,
        state: "idle",
        remaining_seconds: total,
        total_seconds: total,
      };
    });
  }, [backendAvailable]);

  const handleSkip = useCallback(async () => {
    if (backendAvailable) {
      try {
        const next = await skipFocusTimerPhase();
        if (next) {
          setTimer(next);
          return;
        }
      } catch {
        setBackendAvailable(false);
      }
    }
    setTimer((prev) => {
      const nextPhase = getNextPhase(prev.phase, prev.completed_sessions, prev.config.sessions_before_long_break);
      const total = getPhaseDurationSeconds(nextPhase, prev);
      return {
        ...prev,
        state: "idle",
        phase: nextPhase,
        remaining_seconds: total,
        total_seconds: total,
      };
    });
  }, [backendAvailable]);

  const meta = PHASE_META[timer.phase] ?? PHASE_META.work;
  const PhaseIcon = meta.icon;
  const progress = timer.total_seconds > 0
    ? Math.max(0, Math.min(1, (timer.total_seconds - timer.remaining_seconds) / timer.total_seconds))
    : 0;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
            <svg className="-rotate-90 h-20 w-20" viewBox="0 0 80 80" aria-hidden="true">
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                strokeWidth="6"
                className="stroke-muted"
              />
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={cn("transition-all duration-500", meta.stroke)}
              />
            </svg>
            <span className="absolute font-mono text-sm font-bold text-foreground">
              {formatTimerClock(timer.remaining_seconds)}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">Focus Timer</h3>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.badgeClass)}>
                <PhaseIcon className="h-3 w-3" aria-hidden="true" />
                {meta.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {timer.completed_sessions === 1
                ? "1 focus session completed today"
                : `${timer.completed_sessions} focus sessions completed today`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-label={timer.state === "running" ? "Pause focus timer" : "Start focus timer"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {timer.state === "running" ? (
              <>
                <Pause className="h-3.5 w-3.5" weight="fill" aria-hidden="true" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" weight="fill" aria-hidden="true" />
                {timer.state === "paused" ? "Resume" : "Start"}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleReset()}
            aria-label="Reset focus timer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowCounterClockwise className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void handleSkip()}
            aria-label="Skip to next phase"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

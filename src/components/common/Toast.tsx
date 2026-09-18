/**
 * Toast notification system
 * Enhanced with stack limit, progress bar, and better animations
 */

import { useState, useCallback, useMemo } from "react";
import { create } from "zustand";
import { playFeedback, vibrate } from "../../utils/soundService";

/**
 * Toast types
 */
export enum ToastType {
  Success = "success",
  Error = "error",
  Warning = "warning",
  Info = "info",
}

/**
 * Toast notification
 */
export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** @deprecated Kept for compat; progress is now driven by CSS transition */
  progress?: number;
}

/**
 * Toast store
 */
interface ToastStore {
  toasts: ToastData[];
  addToast: (toast: Omit<ToastData, "id" | "progress">) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
  /** @deprecated No longer used; progress is now CSS-driven */
  updateProgress: (id: string, progress: number) => void;
}

const MAX_VISIBLE_TOASTS = 4;

/**
 * Use toast store
 */
export const useToastStore = create<ToastStore>((set, _get) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: ToastData = { ...toast, id, progress: 100 };

    set((state) => {
      const toasts = state.toasts.length >= MAX_VISIBLE_TOASTS
        ? state.toasts.slice(1)
        : state.toasts;
      return { toasts: [...toasts, newToast] };
    });

    // Animate progress bar
    // NOTE: progress animation is now driven entirely by CSS transition
    // on the ToastItem progress bar. We no longer use setInterval to
    // update progress in the store, which previously caused excessive
    // Zustand re-renders (React max-update-depth errors) in heavy
    // components like DocumentViewer.

    // Auto-remove after duration
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }

    return id;
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
  clearAll: () => {
    set({ toasts: [] });
  },
  updateProgress: (id, progress) => {
    set((state) => {
      const target = state.toasts.find((t) => t.id === id);
      if (target && target.progress === progress) return state;
      return {
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, progress } : t
        ),
      };
    });
  },
}));

/**
 * Toast icons
 */
const ToastIcons = {
  [ToastType.Success]: "✓",
  [ToastType.Error]: "!",
  [ToastType.Warning]: "⚠",
  [ToastType.Info]: "i",
};

/** Semantic icon tint per type — the snackbar body stays inverse-surface. */
const ToastIconTint = {
  [ToastType.Success]: "text-success",
  [ToastType.Error]: "text-error",
  [ToastType.Warning]: "text-warning",
  [ToastType.Info]: "text-on-inverse-surface",
};

/**
 * Individual snackbar (Material inverse-surface) with CSS-driven progress
 * bar and pause-on-hover.
 */
function ToastItem({ toast, onRemove }: { toast: ToastData; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const icon = ToastIcons[toast.type];
  const iconTint = ToastIconTint[toast.type];

  const handleRemove = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 200);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`
        md-snackbar relative flex min-w-[288px] max-w-[568px] items-start gap-3 overflow-hidden
        rounded-xs bg-inverse-surface py-3.5 pl-4 pr-1.5 text-on-inverse-surface shadow-lg
        transition-all duration-[var(--md-duration-short)] ease-out
        ${isExiting ? "opacity-0 translate-x-full" : "opacity-100 translate-x-0 animate-slide-up"}
      `}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role={toast.type === ToastType.Error ? "alert" : "status"}
      aria-live="polite"
    >
      {/* Progress bar — CSS animation drives the shrink, no JS state updates */}
      <div
        className="toast-progress-bar absolute bottom-0 left-0 h-0.5 bg-on-inverse-surface/40"
        style={{
          animationDuration: `${toast.duration ?? 5000}ms`,
          animationPlayState: isPaused ? "paused" : "running",
        }}
        aria-hidden="true"
      />

      <span
        className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm font-semibold ${iconTint}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pb-0.5 pr-4">
        <p className="md-body-medium font-medium">{toast.title}</p>
        {toast.message && (
          <p className="md-body-medium mt-0.5 opacity-80">{toast.message}</p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            handleRemove();
          }}
          className="md-state md-label-large my-auto shrink-0 rounded-xs px-3 py-2 font-medium text-inverse-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-primary"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={handleRemove}
        className="md-state my-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-inverse-surface"
        aria-label="Dismiss notification"
      >
        <span className="text-base leading-none" aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/**
 * Toast container component (Material snackbar host: bottom-start placement
 * on wide layouts, full-width bottom placement on phones).
 */
export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="toast-container fixed bottom-4 left-4 right-4 z-[var(--md-z-snackbar)] flex flex-col gap-2 pointer-events-none sm:right-auto sm:w-auto sm:max-w-[min(568px,calc(100vw-2rem))]"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
}

/**
 * Hook to show toast notifications
 */
export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);

  const promiseFn = useCallback(<T,>(
    promise: Promise<T>,
    success: string,
    error?: string
  ): Promise<T> => {
    return promise
      .then((result) => {
        addToast({ type: ToastType.Success, title: success });
        return result;
      })
      .catch((err) => {
        addToast({
          type: ToastType.Error,
          title: error || "An error occurred",
          message: err?.message || String(err),
        });
        throw err;
      });
  }, [addToast]);

  const success = useCallback((title: string, message?: string, options?: Partial<ToastData>) => {
    playFeedback('success');
    return addToast({ type: ToastType.Success, title, message, ...options });
  }, [addToast]);

  const error = useCallback((title: string, message?: string, options?: Partial<ToastData>) => {
    playFeedback('error');
    vibrate('error');
    return addToast({ type: ToastType.Error, title, message, ...options });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string, options?: Partial<ToastData>) => {
    playFeedback('warning');
    return addToast({ type: ToastType.Warning, title, message, ...options });
  }, [addToast]);

  const info = useCallback((title: string, message?: string, options?: Partial<ToastData>) => {
    return addToast({ type: ToastType.Info, title, message, ...options });
  }, [addToast]);

  return useMemo(() => ({
    success,
    error,
    warning,
    info,
    promise: promiseFn,
    dismiss: removeToast,
  }), [success, error, warning, info, promiseFn, removeToast]);
}

/**
 * Toast container provider
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toast />
    </>
  );
}

// Add custom animation styles
const toastStyles = `
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes toast-shrink {
    from { width: 100%; }
    to   { width: 0%; }
  }

  .animate-slide-up {
    animation: slide-up 0.2s ease-out;
  }

  .toast-progress-bar {
    /* Width shrinks from 100% to 0%; actual duration set via inline style */
    animation-name: toast-shrink;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
    animation-play-state: running;
  }

`;

// Inject styles if not already present
if (typeof document !== "undefined") {
  const styleId = "toast-animations";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = toastStyles;
    document.head.appendChild(style);
  }
}

export default Toast;

/**
 * Settings-instance-scoped search target registry (change:
 * improve-settings-search).
 *
 * A Settings search result never manipulates a value. It asks the target
 * primitive that owns the destination to reveal itself (open a nested tab or
 * dialog when necessary), waits for the target to register after lazy panel
 * loading, then scrolls to, focuses, and visibly marks the named container.
 *
 * Every registration lives in a provider mounted inside one Settings instance,
 * so two Settings panes in different tabs cannot resolve each other's targets.
 * No document-wide id lookup is used.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsEink } from "../../../contexts/PresentationContext";
import { useI18n } from "../../../lib/i18n";

/* ------------------------------------------------------------------------- */
/* Public contract                                                           */
/* ------------------------------------------------------------------------- */

export interface SettingsSearchNavigationRequest {
  /** Monotonic request identity; older async work checks this before acting. */
  readonly id: number;
  readonly entryId: string;
  readonly targetId: string;
  readonly revealTargetId?: string;
  readonly label: string;
  readonly section: string;
}

export type SettingsSearchNavigationPhase =
  | "idle"
  | "navigating"
  | "arrived"
  | "missing";

export interface SettingsSearchTargetOptions {
  /** Opens collapsed/nested content that owns this target. */
  reveal?: () => void | Promise<void>;
  /** Accessible name applied to the focusable container when omitted. */
  label?: string;
}

interface TargetRegistration extends SettingsSearchTargetOptions {
  getElement: () => HTMLElement | null;
}

export interface SettingsSearchNavigationState {
  phase: SettingsSearchNavigationPhase;
  /** Entry label that could not be revealed, when phase === "missing". */
  missingLabel: string | null;
  arrivalTargetId: string | null;
  retry: () => void;
  dismiss: () => void;
  registerTarget: (id: string, registration: TargetRegistration) => () => void;
}

const SettingsSearchNavigationContext =
  createContext<SettingsSearchNavigationState | null>(null);

/* ------------------------------------------------------------------------- */
/* Target primitives                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Register a DOM container as a search destination. Returned ref must be
 * attached to the named focus container (the same element users would expect
 * focus to land on).
 */
export function useSettingsSearchTarget(
  targetId: string | undefined,
  options: SettingsSearchTargetOptions = {},
): React.RefObject<HTMLDivElement | null> {
  const navigation = useContext(SettingsSearchNavigationContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const registerTarget = navigation?.registerTarget;

  useLayoutEffect(() => {
    if (!registerTarget || !targetId) return;
    return registerTarget(targetId, {
      getElement: () => ref.current,
      reveal: () => optionsRef.current.reveal?.(),
      label: optionsRef.current.label,
    });
  }, [registerTarget, targetId]);

  return ref;
}

export interface SettingsSearchTargetProps extends SettingsSearchTargetOptions {
  id: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Small wrapper for bespoke panels that cannot use `SettingsRow` /
 * `SettingsSection` without rewriting their layout.
 */
export function SettingsSearchTarget({
  id,
  children,
  className,
  ...options
}: SettingsSearchTargetProps) {
  const ref = useSettingsSearchTarget(id, options);
  return (
    <div
      ref={ref}
      className={className}
      data-settings-search-target={id}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Provider                                                                  */
/* ------------------------------------------------------------------------- */

export interface SettingsSearchNavigationProviderProps {
  children: ReactNode;
  request: SettingsSearchNavigationRequest | null;
  /** Section whose panel is currently mounted; deadline starts after commit. */
  activeSection: string;
  onRequestSettled?: (
    requestId: number,
    outcome: "arrived" | "missing",
  ) => void;
}

const TARGET_DEADLINE_MS = 5_000;
const ARRIVAL_CLASS = "settings-search-target-arrival";
const ARRIVAL_ATTRIBUTE = "data-settings-search-arrival";
const MARKER_ATTRIBUTE = "data-settings-search-marker";

function prefersInstantScroll(isEink: boolean): boolean {
  if (isEink) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function scrollToTarget(element: HTMLElement, instant: boolean): void {
  const behavior: ScrollBehavior = instant ? "auto" : "smooth";
  const scroller = element.closest<HTMLElement>("[data-settings-search-scroller]");
  if (!scroller) {
    try {
      element.scrollIntoView({ block: "center", behavior });
    } catch {
      // jsdom / older webviews may not implement scrollIntoView.
    }
    return;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  const headerOffset = 24;
  const centeredOffset = Math.max(
    headerOffset,
    (scroller.clientHeight - targetRect.height) / 3,
  );
  const top =
    scroller.scrollTop + targetRect.top - scrollerRect.top - centeredOffset;
  try {
    scroller.scrollTo({ top: Math.max(0, top), behavior });
  } catch {
    scroller.scrollTop = Math.max(0, top);
  }
}

function clearArrival(element: HTMLElement | null): void {
  if (!element) return;
  element.classList.remove(ARRIVAL_CLASS);
  element.removeAttribute(ARRIVAL_ATTRIBUTE);
  element.querySelector(`[${MARKER_ATTRIBUTE}]`)?.remove();
  if (element.dataset.settingsSearchRestoreTabIndex !== undefined) {
    const restore = element.dataset.settingsSearchRestoreTabIndex;
    if (restore === "") element.removeAttribute("tabindex");
    else element.setAttribute("tabindex", restore);
    delete element.dataset.settingsSearchRestoreTabIndex;
  }
}

export function SettingsSearchNavigationProvider({
  children,
  request,
  activeSection,
  onRequestSettled,
}: SettingsSearchNavigationProviderProps) {
  const { t } = useI18n();
  const isEink = useIsEink();
  const [registrations, setRegistrations] = useState<ReadonlyMap<string, TargetRegistration>>(
    () => new Map(),
  );
  const [phase, setPhase] = useState<SettingsSearchNavigationPhase>("idle");
  const [missingLabel, setMissingLabel] = useState<string | null>(null);
  const [arrivalTargetId, setArrivalTargetId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const registrationsRef = useRef(registrations);
  registrationsRef.current = registrations;
  const requestRef = useRef(request);
  requestRef.current = request;
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const settledForRequestRef = useRef<number | null>(null);
  const revealedForRequestRef = useRef<number | null>(null);
  const markerElementRef = useRef<HTMLElement | null>(null);

  const registerTarget = useCallback(
    (id: string, registration: TargetRegistration) => {
      setRegistrations((previous) => {
        const next = new Map(previous);
        next.set(id, registration);
        return next;
      });
      return () => {
        setRegistrations((previous) => {
          if (!previous.has(id)) return previous;
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
      };
    },
    [],
  );

  /** Drop any previous arrival marker before a new request takes over. */
  useEffect(() => {
    if (markerElementRef.current) clearArrival(markerElementRef.current);
    markerElementRef.current = null;
    setArrivalTargetId(null);
    if (!request) {
      setPhase("idle");
      setMissingLabel(null);
      return;
    }
    setPhase("navigating");
    setMissingLabel(null);
  }, [request?.id, request]);

  /** Bounded deadline after the selected panel commits. */
  useEffect(() => {
    if (!request) return;
    if (activeSection !== request.section) return;
    if (settledForRequestRef.current === request.id) return;
    const requestId = request.id;
    const timer = window.setTimeout(() => {
      if (
        requestRef.current?.id !== requestId ||
        settledForRequestRef.current === requestId
      ) {
        return;
      }
      // A reveal callback may still be opening nested content; give it the
      // same bounded window before reporting failure.
      settledForRequestRef.current = requestId;
      setPhase("missing");
      setMissingLabel(request.label);
      onRequestSettled?.(requestId, "missing");
    }, TARGET_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [request, activeSection, retryToken, onRequestSettled]);

  /**
   * Resolve the pending target. Effect re-runs whenever registrations change,
   * which is the readiness signal for lazy panels and nested surfaces.
   */
  useEffect(() => {
    if (!request) return;
    if (settledForRequestRef.current === request.id) return;

    const target = registrationsRef.current.get(request.targetId);
    const revealTarget = request.revealTargetId
      ? registrationsRef.current.get(request.revealTargetId)
      : undefined;

    const revealOnce = async () => {
      if (revealedForRequestRef.current === request.id) return;
      const resolver = revealTarget ?? target;
      if (!resolver?.reveal) return;
      revealedForRequestRef.current = request.id;
      try {
        await resolver.reveal();
      } catch {
        // A rejected reveal falls through to the deadline/recovery path.
      }
      if (requestRef.current?.id !== request.id) return;
    };

    if (!target) {
      if (revealTarget?.reveal) void revealOnce();
      return;
    }

    void revealOnce();

    const element = target.getElement();
    if (!element) return;

    settledForRequestRef.current = request.id;
    markerElementRef.current = element;
    element.classList.add(ARRIVAL_CLASS);
    element.setAttribute(ARRIVAL_ATTRIBUTE, "true");
    if (element.dataset.settingsSearchRestoreTabIndex === undefined) {
      element.dataset.settingsSearchRestoreTabIndex = element.getAttribute("tabindex") ?? "";
    }
    element.setAttribute("tabindex", "-1");
    if (target.label && !element.getAttribute("aria-label") && !element.textContent?.trim()) {
      element.setAttribute("aria-label", target.label);
    }

    const marker = document.createElement("span");
    marker.setAttribute(MARKER_ATTRIBUTE, "true");
    marker.className =
      "settings-search-target-marker inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary";
    marker.textContent = t("settings.searchMatch");
    element.prepend(marker);

    const instant = prefersInstantScroll(isEink);
    scrollToTarget(element, instant);
    element.focus({ preventScroll: true });
    setArrivalTargetId(request.targetId);
    setPhase("arrived");
    onRequestSettled?.(request.id, "arrived");
  }, [request, registrations, retryToken, isEink, t, onRequestSettled]);

  /** Clean up marker/classes when the provider unmounts. */
  useEffect(
    () => () => {
      clearArrival(markerElementRef.current);
      markerElementRef.current = null;
    },
    [],
  );

  const retry = useCallback(() => {
    if (!request) return;
    settledForRequestRef.current = null;
    revealedForRequestRef.current = null;
    setMissingLabel(null);
    setPhase("navigating");
    setRetryToken((value) => value + 1);
  }, [request]);

  const dismiss = useCallback(() => {
    setMissingLabel(null);
    setPhase("idle");
  }, []);

  const contextValue = useMemo(
    () => ({
      phase,
      missingLabel,
      arrivalTargetId,
      retry,
      dismiss,
      registerTarget,
    }),
    [phase, missingLabel, arrivalTargetId, retry, dismiss, registerTarget],
  );

  return (
    <SettingsSearchNavigationContext.Provider value={contextValue}>
      {children}
    </SettingsSearchNavigationContext.Provider>
  );
}

export function useSettingsSearchNavigation(): SettingsSearchNavigationState {
  const context = useContext(SettingsSearchNavigationContext);
  if (!context) {
    throw new Error(
      "useSettingsSearchNavigation must be used inside SettingsSearchNavigationProvider",
    );
  }
  return context;
}

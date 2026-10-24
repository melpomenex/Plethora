import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BookOpen,
  Broadcast,
  CaretUp,
  Headphones,
  Pause,
  Play,
  Queue,
  Stop,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";
import type { AudioSourceKey } from "../../types/audioEdition";
import { IconButton } from "../md3/IconButton";
import { useI18n } from "../../lib/i18n";
import { highestOverlayPriority, subscribeOverlayStack } from "../../lib/overlayStack";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "../../services/audio/audioPlaybackRollout";
import { audioTime, runAudioAction } from "./audioPlayerActions";
import "./audio-player.css";

const Expanded = lazy(() =>
  import("./ExpandedAudioPlayer").then(module => ({ default: module.ExpandedAudioPlayer })),
);

function findScrollableAncestor(start: HTMLElement, boundary: HTMLElement): HTMLElement | null {
  let cursor: HTMLElement | null = start;
  while (cursor && cursor !== boundary) {
    const style = window.getComputedStyle(cursor);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && cursor.scrollHeight > cursor.clientHeight) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}

function applyReservedDockHeight(shell: HTMLElement, prevHeight: number, nextHeight: number): void {
  if (Math.abs(nextHeight - prevHeight) < 0.5) {
    if (nextHeight > 0) shell.style.setProperty("--shell-audio-player-height", `${nextHeight}px`);
    else shell.style.removeProperty("--shell-audio-player-height");
    return;
  }
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const rawNode = range?.commonAncestorContainer ?? null;
  const anchorEl = rawNode instanceof HTMLElement ? rawNode : rawNode?.parentElement ?? null;
  const scroller = anchorEl && shell.contains(anchorEl) ? findScrollableAncestor(anchorEl, shell) : null;
  const beforeRangeBottom = range && scroller ? range.getBoundingClientRect().bottom : null;
  const beforeScrollerBottom = scroller ? scroller.getBoundingClientRect().bottom : null;
  const wasSelectionVisible =
    beforeRangeBottom !== null &&
    beforeScrollerBottom !== null &&
    beforeRangeBottom <= beforeScrollerBottom + 2;

  if (nextHeight > 0) {
    shell.style.setProperty("--shell-audio-player-height", `${nextHeight}px`);
  } else {
    shell.style.removeProperty("--shell-audio-player-height");
  }

  const delta = nextHeight - prevHeight;
  if (delta > 0 && scroller && range && wasSelectionVisible && beforeRangeBottom !== null && beforeScrollerBottom !== null) {
    const afterScrollerBottom = scroller.getBoundingClientRect().bottom;
    const afterRangeBottom = range.getBoundingClientRect().bottom;
    const effectiveBottom =
      Math.abs(afterScrollerBottom - beforeScrollerBottom) < 0.5
        ? beforeScrollerBottom - delta
        : afterScrollerBottom;
    if (afterRangeBottom > effectiveBottom) {
      scroller.scrollTop += Math.ceil(afterRangeBottom - effectiveBottom + 8);
    }
  }
}

function isFocusableVisible(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  if ((element as HTMLButtonElement).disabled) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
}

/** Slot follows the shell lifetime; its visibility never controls the playback owner. */
export function AudioDock({
  mobile = false,
  fullscreen = false,
  dockRef,
}: {
  mobile?: boolean;
  fullscreen?: boolean;
  dockRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!GLOBAL_AUDIO_PLAYBACK_ENABLED) return null;
  return <AudioDockPresentation mobile={mobile} fullscreen={fullscreen} dockRef={dockRef} />;
}

export function AudioDockPresentation({
  mobile,
  fullscreen,
  dockRef,
}: {
  mobile: boolean;
  fullscreen: boolean;
  dockRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = dockRef ?? ownRef;
  const lastReservedHeightRef = useRef(0);
  const invokerRef = useRef<HTMLElement | null>(null);
  const wasExpandedRef = useRef(false);
  const loaded = useAudioPlaybackStore(state => state.snapshot !== null);
  const expanded = useAudioPlaybackStore(state => state.expanded);
  const overlay = useSyncExternalStore(subscribeOverlayStack, highestOverlayPriority, () => 0);
  const [keyboardState, setKeyboardState] = useState<{ open: boolean; cramped: boolean }>({
    open: false,
    cramped: false,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (!viewport) {
        setKeyboardState(prev => (!prev.open && !prev.cramped ? prev : { open: false, cramped: false }));
        return;
      }
      const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const open = keyboardHeight > 80 || viewport.height < window.innerHeight * 0.75;
      const cramped = open && (viewport.height < 360 || viewport.height < window.innerHeight * 0.75);
      setKeyboardState(prev => (prev.open === open && prev.cramped === cramped ? prev : { open, cramped }));
    };
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    const shell = element?.closest<HTMLElement>(".adaptive-shell-root");
    if (!element || !shell) return;
    const read = () => {
      const nextHeight = loaded && !fullscreen ? element.getBoundingClientRect().height : 0;
      const prevHeight = lastReservedHeightRef.current;
      lastReservedHeightRef.current = nextHeight;
      applyReservedDockHeight(shell, prevHeight, nextHeight);
    };
    read();
    const resize = new ResizeObserver(read);
    resize.observe(element);
    return () => {
      resize.disconnect();
      const prevHeight = lastReservedHeightRef.current;
      lastReservedHeightRef.current = 0;
      applyReservedDockHeight(shell, prevHeight, 0);
    };
  }, [loaded, fullscreen, ref]);

  useLayoutEffect(() => {
    if (expanded) {
      if (!invokerRef.current && document.activeElement instanceof HTMLElement) {
        invokerRef.current = document.activeElement;
      }
      wasExpandedRef.current = true;
      return;
    }
    if (!wasExpandedRef.current) return;
    // An overlay was still registered during the collapse commit (for example the
    // expanded dialog's own dismissal). Keep the pending restoration and retry when
    // the overlay stack drains so the dock is no longer inert.
    if (overlay > 0) return;
    wasExpandedRef.current = false;
    if (!loaded) {
      invokerRef.current = null;
      return;
    }
    const preferred = invokerRef.current;
    invokerRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (isFocusableVisible(preferred)) {
        preferred.focus();
        return;
      }
      const fallback = ref.current?.querySelector<HTMLElement>(".audio-player-identity");
      if (isFocusableVisible(fallback ?? null)) {
        fallback?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, loaded, overlay, ref]);

  if (!loaded) return null;

  const hiddenByKeyboard = mobile && keyboardState.cramped;
  const blockedByModal = overlay > 0;
  const inertDock = fullscreen || hiddenByKeyboard || blockedByModal;
  const openExpanded = (target: HTMLElement) => {
    invokerRef.current = target;
    useAudioPlaybackStore.setState({ expanded: true });
  };

  return (
    <>
      <div
        ref={ref}
        className={`audio-dock-slot ${mobile ? "audio-dock-mobile" : "audio-dock-desktop"}`}
        hidden={fullscreen}
        data-keyboard-open={mobile && keyboardState.open && !keyboardState.cramped ? "true" : undefined}
        style={{ visibility: hiddenByKeyboard ? "hidden" : undefined }}
        inert={inertDock}
        aria-hidden={inertDock || undefined}
      >
        <div className="audio-dock-controls">
          <MiniAudioPlayer mobile={mobile} onExpand={openExpanded} />
        </div>
      </div>
      <AudioPlayerLiveStatus />
      {expanded && (
        <Suspense fallback={null}>
          <Expanded mobile={mobile} />
        </Suspense>
      )}
    </>
  );
}

function sourceFallbackIcon(kind: AudioSourceKey["kind"] | undefined) {
  switch (kind) {
    case "audio_edition":
      return BookOpen;
    case "podcast":
      return Broadcast;
    case "recording":
      return Waveform;
    case "audiobook":
    default:
      return Headphones;
  }
}

export function AudioPlayerTitle() {
  const { t } = useI18n();
  const title = useAudioPlaybackStore(state => state.snapshot?.metadata.title ?? "");
  const section = useAudioPlaybackStore(state => state.snapshot?.section?.title ?? "");
  const artwork = useAudioPlaybackStore(state => state.snapshot?.metadata.artworkUrl);
  const kind = useAudioPlaybackStore(state => state.snapshot?.sourceKey.kind);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [artwork]);
  const FallbackIcon = sourceFallbackIcon(kind);
  return (
    <>
      <span className="audio-player-art" aria-hidden="true" data-fallback-kind={!artwork || failed ? (kind ?? "audiobook") : undefined}>
        {artwork && !failed ? (
          <img src={artwork} alt="" onError={() => setFailed(true)} />
        ) : (
          <FallbackIcon />
        )}
      </span>
      <span className="audio-player-title">
        <span className="truncate font-medium" title={title}>
          {title || t("audio.player")}
        </span>
        {section && section !== title && (
          <span className="truncate text-xs text-on-surface-variant" title={section}>
            {section}
          </span>
        )}
      </span>
    </>
  );
}

export function AudioTransport({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n();
  const playing = useAudioPlaybackStore(state => state.snapshot?.playIntent ?? false);
  const state = useAudioPlaybackStore(state => state.snapshot?.state);
  const canSeek = useAudioPlaybackStore(state => state.snapshot?.capabilities.canSeekRelative ?? false);
  const kind = useAudioPlaybackStore(state => state.snapshot?.sourceKey.kind);
  const backward = kind === "recording" ? 10 : 30;
  const size = mobile ? "lg" : "md";
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label={t("audio.transport")}>
      <IconButton
        size={size}
        icon={ArrowCounterClockwise}
        aria-label={t("audio.back", { seconds: backward })}
        title={t("audio.back", { seconds: backward })}
        disabled={!canSeek}
        onClick={() => void runAudioAction(owner => owner.seekRelative(-backward))}
      />
      <IconButton
        size={size}
        variant="filled"
        icon={playing ? Pause : Play}
        aria-label={t(playing ? "audio.pause" : "audio.play")}
        disabled={state === "loading"}
        onClick={() => void runAudioAction(owner => (playing ? owner.pause() : owner.play()))}
      />
      <IconButton
        size={size}
        icon={ArrowClockwise}
        aria-label={t("audio.forward", { seconds: 30 })}
        title={t("audio.forward", { seconds: 30 })}
        disabled={!canSeek}
        onClick={() => void runAudioAction(owner => owner.seekRelative(30))}
      />
    </div>
  );
}

function MiniProgressRail() {
  const { t } = useI18n();
  const position = useAudioPlaybackStore(state => state.snapshot?.positionSec ?? 0);
  const duration = useAudioPlaybackStore(state => state.snapshot?.durationSec);
  return (
    <progress
      className="audio-player-progress"
      aria-label={t("audio.progress")}
      max={duration && duration > 0 ? duration : 1}
      value={duration && duration > 0 ? Math.min(position, duration) : 0}
    />
  );
}

function MiniElapsedReadout() {
  const position = useAudioPlaybackStore(state => state.snapshot?.positionSec ?? 0);
  const duration = useAudioPlaybackStore(state => state.snapshot?.durationSec);
  return (
    <span className="audio-player-elapsed tabular-nums text-xs text-on-surface-variant" aria-hidden="true">
      {audioTime(position)}
      {duration !== null && duration !== undefined ? ` / ${audioTime(duration)}` : ""}
    </span>
  );
}

/** Announces semantic source/state/error transitions only; never subscribes to position ticks. */
function AudioPlayerLiveStatus() {
  const { t } = useI18n();
  const title = useAudioPlaybackStore(state => state.snapshot?.metadata.title ?? "");
  const playbackState = useAudioPlaybackStore(state => state.snapshot?.state ?? null);
  const errorText = useAudioPlaybackStore(
    state => state.controlError || state.snapshot?.error?.message || state.storageError || state.adapterError || null,
  );

  let statusText = "";
  if (errorText) {
    statusText = `${title ? `${title}: ` : ""}${errorText}`;
  } else if (playbackState === "playing") {
    statusText = `${t("audio.playing")}${title ? `: ${title}` : ""}`;
  } else if (playbackState === "paused") {
    statusText = `${t("audio.paused")}${title ? `: ${title}` : ""}`;
  } else if (playbackState === "loading") {
    statusText = t("audio.loading");
  } else if (playbackState === "buffering") {
    statusText = t("audio.buffering");
  } else if (playbackState === "ended") {
    statusText = `${t("audio.ended")}${title ? `: ${title}` : ""}`;
  }

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="audio-player-live-status">
      {statusText}
    </div>
  );
}

function MiniAudioPlayer({
  mobile,
  onExpand,
}: {
  mobile: boolean;
  onExpand: (target: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const title = useAudioPlaybackStore(state => state.snapshot?.metadata.title ?? "");
  const section = useAudioPlaybackStore(state => state.snapshot?.section?.title ?? "");
  const attentionId = useId();
  const hasQueue = useAudioPlaybackStore(state => (state.snapshot?.queue?.length ?? 0) > 1);
  const error = useAudioPlaybackStore(state =>
    Boolean(state.snapshot?.error || state.storageError || state.controlError || state.adapterError),
  );
  return (
    <section className="audio-mini-player" aria-label={t("audio.player")}>
      <MiniProgressRail />
      <button
        type="button"
        className="audio-player-identity md-focus-ring"
        aria-label={`${t("audio.expand")}: ${title}${section && section !== title ? `, ${section}` : ""}`}
        aria-describedby={error ? attentionId : undefined}
        onClick={event => onExpand(event.currentTarget)}
      >
        <AudioPlayerTitle />
        {error && (
          <>
            <WarningCircle className="h-5 w-5 shrink-0 text-error" aria-hidden="true" />
            <span id={attentionId} className="sr-only">
              {t("audio.needsAttention")}
            </span>
          </>
        )}
      </button>
      <AudioTransport mobile={mobile} />
      {!mobile && <MiniElapsedReadout />}
      {!mobile && (
        <div className="audio-player-secondary flex items-center">
          {hasQueue && (
            <IconButton
              icon={Queue}
              aria-label={t("audio.queue")}
              onClick={event => onExpand(event.currentTarget)}
            />
          )}
          <IconButton
            className="audio-player-expand-secondary"
            icon={CaretUp}
            aria-label={t("audio.expand")}
            onClick={event => onExpand(event.currentTarget)}
          />
          <IconButton
            icon={Stop}
            aria-label={t("audio.stop")}
            onClick={() => void runAudioAction(owner => owner.stopAndClose())}
          />
        </div>
      )}
    </section>
  );
}

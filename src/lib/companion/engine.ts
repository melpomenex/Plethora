/**
 * Companion engine — pure reaction selection.
 *
 * Maps a structured event to a proposed reaction (state + optional speech),
 * then defers to the policy for speech eligibility. Animations may still play
 * when speech is suppressed — movement is cheap and non-interrupting, speech
 * is the scarce resource.
 */

import { decideSpeech, eventAllowedBySettings } from "./policy";
import type {
  CompanionContext,
  CompanionEvent,
  CompanionReaction,
} from "./types";

interface EngineState {
  lastEventAt: Partial<Record<CompanionEvent["type"], number>>;
}

export function createCompanionEngine() {
  const state: EngineState = { lastEventAt: {} };

  /** Minimum spacing between reactions to the SAME event type (ms). */
  const EVENT_DEBOUNCE_MS = 45_000;
  /** Reactions that only make sense with speech; skipped entirely if muted. */
  const TALK_REACTIONS = new Set(["talk"]);

  function react(event: CompanionEvent, ctx: CompanionContext): CompanionReaction | null {
    if (!eventAllowedBySettings(event, ctx.settings)) return null;

    const last = state.lastEventAt[event.type] ?? -Infinity;
    const debounced = ctx.now - last < EVENT_DEBOUNCE_MS;
    const proposal = propose(event, ctx);
    if (!proposal) return null;

    const needsSpeech = Boolean(proposal.speechKey);
    const speechOk = decideSpeech(ctx, proposal.speechKey).allow;

    // Talks without speech are pointless; transient reactions may animate alone.
    if (TALK_REACTIONS.has(proposal.state) && (!needsSpeech || !speechOk)) {
      return null;
    }

    if (debounced) {
      // Cooldown for this event type: keep the animation, drop the bubble.
      return needsSpeech ? { ...proposal, speechKey: undefined, speechVars: undefined } : proposal;
    }

    state.lastEventAt[event.type] = ctx.now;
    return needsSpeech && !speechOk
      ? { ...proposal, speechKey: undefined, speechVars: undefined }
      : proposal;
  }

  return { react };
}

function propose(event: CompanionEvent, ctx: CompanionContext): CompanionReaction | null {
  switch (event.type) {
    case "app_launched":
      return { state: "talk", speechKey: "companion.welcomeBack", durationMs: 4000 };
    case "document_opened":
      return { state: "look", speechKey: "companion.documentOpened", speechVars: { title: event.title ?? "" }, durationMs: 3500 };
    case "reading_milestone":
      if (event.percent >= 0.9) {
        return { state: "talk", speechKey: "companion.chapterEnd", durationMs: 4000 };
      }
      return { state: "look", speechKey: "companion.readingAlong", durationMs: 3000 };
    case "highlight_created":
      return { state: "curious", speechKey: "companion.highlightCreated", durationMs: 3000 };
    case "extract_created":
      return { state: "celebrate", speechKey: "companion.extractCreated", durationMs: 2600 };
    case "card_created":
      return { state: "celebrate", speechKey: "companion.cardCreated", durationMs: 2600 };
    case "review_correct":
      if ((event.streak ?? 0) >= 5) {
        return { state: "celebrate", speechKey: "companion.streak", speechVars: { count: event.streak ?? 0 }, durationMs: 3000 };
      }
      return { state: "celebrate", durationMs: 1800 };
    case "review_difficult":
      return { state: "think", speechKey: "companion.trickyCard", durationMs: 3200 };
    case "review_session_completed":
      return { state: "celebrate", speechKey: "companion.sessionDone", speechVars: { count: event.count }, durationMs: 3500 };
    case "rss_liked":
      return { state: "curious", speechKey: "companion.rssLiked", durationMs: 3000 };
    case "rss_disliked":
      return { state: "sleep", durationMs: 2000 };
    case "queue_due_changed":
      return event.count > 0 ? { state: "look", durationMs: 2000 } : null;
    default:
      return null;
  }
}

/** Ambient idle behavior — called on a low-frequency ambient tick. */
export function ambientReaction(seedUnit: number, ctx: CompanionContext): CompanionReaction {
  // Deterministic pick from the seed: mostly look/blink, occasional hop,
  // sleep only after long inactivity.
  const idleMs = ctx.msSinceLastSpeech;
  if (idleMs > 30 * 60_000 && seedUnit < 0.5) return { state: "sleep", durationMs: 8000 };
  if (seedUnit < 0.35) return { state: "blink", durationMs: 700 };
  if (seedUnit < 0.55) return { state: "look", durationMs: 2200 };
  if (seedUnit < 0.65) return { state: "hop", durationMs: 1400 };
  return { state: "idle", durationMs: 4000 };
}

import { useSettingsStore } from "../stores/settingsStore";
import { emitInteractionFeedback } from "./feedback/orchestrator";
import { getHapticsSnapshot } from "./feedback/haptics/service";

const RECENT_LIMIT = 256;

export interface NavigationCompletion {
  complete(): void;
  defer(): void;
  suppress(): void;
  isDeferred(): boolean;
  isFinished(): boolean;
}

export interface NavigationFeedbackOptions {
  isEnabled: () => boolean;
  isSupported: () => boolean;
  vibrate: (id?: string) => boolean | void;
}

export function createNavigationFeedback(options: NavigationFeedbackOptions): (id: string) => boolean {
  const seen = new Set<string>();
  const order: string[] = [];
  return (id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    order.push(id);
    if (order.length > RECENT_LIMIT) {
      const expired = order.shift();
      if (expired) seen.delete(expired);
    }
    try {
      if (!options.isEnabled() || !options.isSupported()) return false;
      return options.vibrate(id) !== false;
    } catch {
      return false;
    }
  };
}

const emitNavigationFeedback = createNavigationFeedback({
  isEnabled: () => useSettingsStore.getState().settings.haptics.enabled,
  isSupported: () => {
    const { configured, capabilities } = getHapticsSnapshot();
    return configured && capabilities.hardware === "available";
  },
  vibrate: (id) => emitInteractionFeedback("navigation.back-completed", {}, {
    interactionId: `navigation:${id}:back`,
    operationId: id,
    origin: "user",
  }).channels.includes("haptic"),
});

export function createNavigationCompletion(
  id: string,
  emitFeedback: (id: string) => boolean = emitNavigationFeedback,
): NavigationCompletion {
  let deferred = false;
  let finished = false;
  return {
    complete() {
      if (finished) return;
      finished = true;
      try {
        emitFeedback(id);
      } catch {
        // Haptic delivery must never block the Back result or native ACK.
      }
    },
    defer() {
      if (!finished) deferred = true;
    },
    suppress() {
      if (!finished) {
        finished = true;
        deferred = true;
      }
    },
    isDeferred: () => deferred,
    isFinished: () => finished,
  };
}

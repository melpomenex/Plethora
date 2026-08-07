/**
 * How a scroll session is composed from the Documents / Extracts / Flashcards
 * targets in Queue Settings.
 *
 * It lives here rather than inline in QueueScrollPage so the rule is testable
 * without mounting a ~4000-line component (same reasoning as extractModeGate).
 *
 * `splitReviewBudget` used to compute a flashcard count from a single
 * percentage and a boolean, leaving documents out of the budget entirely —
 * which is why a document-heavy queue stayed document-heavy at any setting.
 * `composeSession` replaces it: the three targets are normalized to shares of
 * the assembled session, the session is anchored on the documents share, and
 * unfillable shares are redistributed instead of shrinking the session.
 */
export interface CompositionTargets {
  documents: number;
  extracts: number;
  flashcards: number;
}

export interface CompositionInput {
  /** Raw slider values (0-100, need not sum to 100). */
  targets: CompositionTargets;
  /** How many items of each type actually exist. */
  available: CompositionTargets;
}

/**
 * Compute how many items of each type a scroll session should hold.
 *
 * 1. Normalize the targets to weights `w` (each target's share of the sum).
 * 2. Anchor the session size on documents: `N = a.documents / w.documents`
 *    (documents are the reading queue's bounded backbone; anchoring on the
 *    near-unbounded flashcard pool would produce enormous sessions).
 * 3. Allocate `w_i × N` to each type, clamped by availability, and iterate:
 *    the shortfall from a clamped type is reallocated proportionally to the
 *    types that still have headroom (at most one type exhausts per pass, so
 *    this terminates within three passes).
 * 4. Round with the largest-remainder method so the counts sum to `N`.
 *
 * Fallbacks: when `w.documents == 0` or no documents are available, anchor on
 * whichever remaining active type has the largest target with items
 * available; when no type is active, return all zeros.
 */
export function composeSession({ targets, available }: CompositionInput): CompositionTargets {
  // Type indices: 0 = documents, 1 = extracts, 2 = flashcards.
  const t = [
    Math.max(0, targets.documents),
    Math.max(0, targets.extracts),
    Math.max(0, targets.flashcards),
  ];
  const targetSum = t[0] + t[1] + t[2];
  if (targetSum <= 0) return { documents: 0, extracts: 0, flashcards: 0 };

  // Normalize the targets to weights `w` (each target's share of the sum).
  const w = [t[0] / targetSum, t[1] / targetSum, t[2] / targetSum];

  // Anchor the session size on documents: `N = a.documents / w.documents`
  // (documents are the reading queue's bounded backbone; anchoring on the
  // near-unbounded flashcard pool would produce enormous sessions). Fall back
  // to whichever remaining active type has the largest target with items.
  const avail = [available.documents, available.extracts, available.flashcards];
  let anchor = -1;
  if (w[0] > 0 && avail[0] > 0) {
    anchor = 0;
  } else {
    for (let i = 1; i < 3; i++) {
      if (w[i] > 0 && avail[i] > 0 && (anchor === -1 || t[i] > t[anchor])) anchor = i;
    }
  }
  if (anchor === -1) return { documents: 0, extracts: 0, flashcards: 0 };
  const n = avail[anchor] / w[anchor];

  // Iterated proportional redistribution: each pass fills up to the ideal
  // share, clamped by what remains available; the leftover moves on to the
  // types that still have headroom, in proportion to their own targets. At
  // most one type exhausts per pass, so this terminates within three passes.
  const counts = [0, 0, 0];
  let unfilled = n;
  let guard = 0;
  while (unfilled > 0 && guard++ < 3) {
    let totalWeight = 0;
    let activeCount = 0;
    for (let i = 0; i < 3; i++) {
      if (w[i] > 0 && avail[i] - counts[i] > 0) {
        totalWeight += w[i];
        activeCount++;
      }
    }
    if (activeCount === 0) break;
    let allocated = 0;
    for (let i = 0; i < 3; i++) {
      if (w[i] > 0 && avail[i] - counts[i] > 0) {
        const take = Math.min(avail[i] - counts[i], (w[i] / totalWeight) * unfilled);
        counts[i] += take;
        allocated += take;
      }
    }
    unfilled -= allocated;
  }

  // Round with the largest-remainder method so the counts sum exactly to
  // round(N); a 1-item type is never rounded out of existence. If every type
  // is exhausted the session is simply every available item — never padded.
  const total = Math.round(n);
  const result = [
    Math.floor(counts[0]),
    Math.floor(counts[1]),
    Math.floor(counts[2]),
  ];
  let seats = total - (result[0] + result[1] + result[2]);
  if (seats > 0) {
    const frac = [counts[0] - result[0], counts[1] - result[1], counts[2] - result[2]];
    const order = [0, 1, 2].sort((x, y) => frac[y] - frac[x] || x - y);
    for (const i of order) {
      if (seats <= 0 || frac[i] <= 0) continue;
      result[i] += 1;
      seats -= 1;
    }
  }
  return {
    documents: result[0],
    extracts: result[1],
    flashcards: result[2],
  };
}

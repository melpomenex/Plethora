import type { PaletteActionId } from "./types";

/**
 * Reference order of the six Quick Action tiles. Kept as a flat list so the
 * hub's keyboard selection sequence and the presentation row cannot drift.
 */
export const PALETTE_QUICK_ACTION_ORDER: PaletteActionId[] = [
  "palette.resume",
  "palette.openRecent",
  "palette.reviewDue",
  "palette.askLibrary",
  "palette.openSettings",
  "palette.createNote",
];

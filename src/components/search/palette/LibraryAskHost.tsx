/**
 * Host for palette → library-assistant handoffs.
 *
 * The palette stores a typed pending question (`libraryAskHandoff`) and closes;
 * this host (mounted once in the app shell) opens the existing grounded
 * library-assistant composer with that question prefilled and focused. The
 * handoff is consumed exactly once, survives navigation because it is typed
 * state rather than a timed window event, and starts no model request — the
 * user still presses Ask.
 */

import { lazy, Suspense } from "react";
import { useLibraryAskHandoffStore } from "../../../commandPalette/libraryAskHandoff";

const SelectionActionsSheet = lazy(() =>
  import("../../viewer/SelectionActionsSheet").then((m) => ({
    default: m.SelectionActionsSheet,
  }))
);

export function LibraryAskHost() {
  const pending = useLibraryAskHandoffStore((state) => state.pending);
  const consumeAsk = useLibraryAskHandoffStore((state) => state.consumeAsk);

  if (!pending) return null;

  return (
    <Suspense fallback={null}>
      <SelectionActionsSheet
        key={pending.nonce}
        open={true}
        text=""
        initialQuestion={pending.question}
        initialContextPassage={pending.contextPassage}
        onClose={consumeAsk}
      />
    </Suspense>
  );
}

export type OverlayDismiss = () => void;

interface OverlayEntry {
  id: symbol;
  dismiss: OverlayDismiss;
  priority: number;
  order: number;
}

const entries: OverlayEntry[] = [];
let order = 0;

export function registerOverlayDismissal(
  dismiss: OverlayDismiss,
  priority = 0,
): () => void {
  const entry: OverlayEntry = {
    id: Symbol("overlay"),
    dismiss,
    priority,
    order: order++,
  };
  entries.push(entry);
  return () => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) entries.splice(index, 1);
  };
}

export function requestOverlayBack(): boolean {
  const entry = [...entries].sort(
    (a, b) => b.priority - a.priority || b.order - a.order,
  )[0];
  if (!entry) return false;
  entry.dismiss();
  return true;
}

export function resetOverlayStackForTests() {
  entries.splice(0, entries.length);
  order = 0;
}


export type ContextualBackHandler = () => boolean;

interface ContextualBackEntry {
  id: symbol;
  handler: ContextualBackHandler;
  priority: number;
  order: number;
}

const entries: ContextualBackEntry[] = [];
let order = 0;

export function registerContextualBackHandler(
  handler: ContextualBackHandler,
  priority = 0,
): () => void {
  const entry: ContextualBackEntry = {
    id: Symbol("contextual-back"),
    handler,
    priority,
    order: order++,
  };
  entries.push(entry);

  return () => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) entries.splice(index, 1);
  };
}

export function requestContextualBack(): boolean {
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.order - a.order,
  );
  for (const entry of ordered) {
    if (entry.handler()) return true;
  }
  return false;
}

export function resetContextualBackHandlersForTests() {
  entries.splice(0, entries.length);
  order = 0;
}

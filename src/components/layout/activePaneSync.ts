export function syncActivePaneTabId(
  currentTabId: string | null,
  nextTabId: string | null,
): string | null {
  return currentTabId === nextTabId ? currentTabId : nextTabId;
}

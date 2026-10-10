/** Hold workspace mutations until native root authorization settles. */
let reserved = false;
let backgrounded = false;
const deferred: Array<() => void> = [];

function flush(): void {
  if (reserved || backgrounded) return;
  deferred.splice(0).forEach((mutation) => mutation());
}

export function deferNavigationMutation(mutation: () => void): boolean {
  if (!reserved && !backgrounded) return false;
  // Keep the bounded transport interval from accumulating unbounded input.
  if (deferred.length < 256) deferred.push(mutation);
  return true;
}

export function isNavigationRootReserved(): boolean { return reserved || backgrounded; }

export function reserveNavigationRoot(): (didBackground?: boolean) => void {
  reserved = true;
  let released = false;
  return (didBackground = false) => {
    if (released) return;
    released = true;
    reserved = false;
    backgrounded = didBackground;
    flush();
  };
}

export function resumeNavigationMutations(): void {
  if (document.visibilityState === "hidden") return;
  backgrounded = false;
  flush();
}

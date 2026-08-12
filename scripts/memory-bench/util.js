/**
 * Shared small helpers for the memory benchmark driver.
 */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a file as a string, returning null on any error. */
export function tryReadFile(readFileSync, path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

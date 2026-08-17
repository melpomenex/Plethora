/**
 * Async mutex to serialize pdf.js `page.render()` calls across collector
 * rasterization and visual region cropping. pdf.js does not allow concurrent
 * renders on the same worker pipeline; this lock guarantees clean serialization.
 */
let renderMutexPromise: Promise<void> = Promise.resolve();

export async function withPdfRenderLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = renderMutexPromise;
  let release: () => void = () => {};
  renderMutexPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await action();
  } finally {
    release();
  }
}

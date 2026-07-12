/**
 * Owns one asynchronous Vim navigation request at a time. Starting a newer
 * request aborts the previous one and only the newest result may commit UI.
 */
export class VimNavigationRequestCoordinator {
  private sequence = 0;
  private controller: AbortController | null = null;

  async run<T>(
    resolve: (signal: AbortSignal) => Promise<T>,
    commit: (value: T) => void,
  ): Promise<boolean> {
    const requestId = ++this.sequence;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    try {
      const value = await resolve(controller.signal);
      if (controller.signal.aborted || requestId !== this.sequence) return false;
      commit(value);
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== this.sequence) return false;
      throw error;
    } finally {
      if (requestId === this.sequence) this.controller = null;
    }
  }

  cancel(): void {
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

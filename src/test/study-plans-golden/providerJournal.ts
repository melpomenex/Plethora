/** C8-T02 provider journal: metadata only, never secrets/raw learner/source text. */
export interface ProviderCallRecord {
  taskId: string;
  requestHash: string;
  stepKey: string;
  attemptCount: number;
  routeClass: string;
  payloadClasses: string[];
  consented: boolean;
  at: string;
}

export class ProviderJournal {
  private calls: ProviderCallRecord[] = [];
  record(call: Omit<ProviderCallRecord, 'at'>, now = new Date().toISOString()): void {
    const { taskId, requestHash, stepKey, attemptCount, routeClass, payloadClasses, consented } = call;
    this.calls.push({ taskId, requestHash, stepKey, attemptCount, routeClass, payloadClasses, consented, at: now });
  }
  getCalls(): ProviderCallRecord[] {
    return [...this.calls];
  }
  count(): number {
    return this.calls.length;
  }
  clear(): void {
    this.calls = [];
  }
}

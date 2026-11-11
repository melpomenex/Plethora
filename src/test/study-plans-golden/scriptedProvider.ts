/**
 * C8-T02 strict scripted provider: keyed (taskId, requestHash, stepKey, attemptCount).
 * Unexpected requests fail. Journal records metadata only. No paid provider.
 */
import { ProviderJournal } from './providerJournal';

export interface ScriptedKey {
  taskId: string;
  requestHash: string;
  stepKey: string;
  attemptCount: number;
}

function keyOf(k: ScriptedKey): string {
  return JSON.stringify([k.taskId, k.requestHash, k.stepKey, k.attemptCount]);
}

export class ScriptedProvider {
  readonly journal = new ProviderJournal();
  private fixtures = new Map<string, unknown>();
  private attempts = new Map<string, number>();

  script(key: ScriptedKey, output: unknown): void {
    this.fixtures.set(keyOf(key), output);
  }

  async call<T>(key: ScriptedKey, meta: { routeClass: string; payloadClasses: string[]; consented: boolean }): Promise<T> {
    const seen = (this.attempts.get(`${key.taskId}:${key.stepKey}`) ?? 0) + 1;
    this.attempts.set(`${key.taskId}:${key.stepKey}`, seen);
    this.journal.record({ ...key, routeClass: meta.routeClass, payloadClasses: meta.payloadClasses, consented: meta.consented });
    const hit = this.fixtures.get(keyOf(key));
    if (hit === undefined) {
      throw new Error(`scripted-provider: unexpected call ${key.taskId}/${key.stepKey}#${key.attemptCount}`);
    }
    return hit as T;
  }

  callCount(): number {
    return this.journal.count();
  }
}

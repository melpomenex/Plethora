/**
 * Process-local single-flight lease for model work (task 2.4).
 *
 * Foreground explicit AI has priority: a queued passage classification never
 * starts while another task is in flight, and only one passage classifier may
 * run at a time. The lease is released in every terminal path (success,
 * failure, cancellation, teardown) so a lost result can never wedge scoring.
 */

let leaseHolder: string | null = null;

export function tryAcquireModelLease(holder: string): boolean {
  if (leaseHolder && leaseHolder !== holder) return false;
  leaseHolder = holder;
  return true;
}

export function releaseModelLease(holder: string): void {
  if (leaseHolder === holder) leaseHolder = null;
}

export function getModelLeaseHolder(): string | null {
  return leaseHolder;
}

export function resetModelLeaseForTests(): void {
  leaseHolder = null;
}

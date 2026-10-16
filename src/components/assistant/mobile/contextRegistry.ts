import type { MobileAssistantRegistration } from "./contracts";

export interface AssistantActiveOwner { paneId?: string; tabId?: string }

/** Token cleanup cannot remove a newer registration, including a reused owner. */
export class MobileAssistantRegistry {
  private registrations = new Map<symbol, MobileAssistantRegistration>();
  private removed = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  private notify() { this.version++; for (const listener of this.listeners) listener(); }
  register(registration: MobileAssistantRegistration) {
    const token = Symbol("assistant-context");
    this.registrations.set(token, registration);
    this.notify();
    return () => { if (this.registrations.delete(token)) this.notify(); };
  }
  private identity(registration: MobileAssistantRegistration) {
    return `${registration.ownerPaneId}:${registration.ownerTabId}:${registration.revision}`;
  }
  resolve(owner: AssistantActiveOwner): MobileAssistantRegistration | undefined {
    return [...this.registrations.values()].reverse()
      .filter(r => r.ownerPaneId === owner.paneId && r.ownerTabId === owner.tabId)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).at(0);
  }
  isRemoved(registration: MobileAssistantRegistration) { return this.removed.has(this.identity(registration)); }
  remove(registration: MobileAssistantRegistration) { this.removed.add(this.identity(registration)); this.notify(); }
  restore(registration: MobileAssistantRegistration) { this.removed.delete(this.identity(registration)); this.notify(); }
}

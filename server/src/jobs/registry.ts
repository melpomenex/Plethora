import type { JobKindDefinition } from './types.js';

const registry = new Map<string, JobKindDefinition>();

export function registerJobKind(def: JobKindDefinition): void {
  registry.set(def.kind, def);
}

export function getJobKind(kind: string): JobKindDefinition | undefined {
  return registry.get(kind);
}

export function listJobKinds(): string[] {
  return [...registry.keys()];
}

export function assertJobKind(kind: string): JobKindDefinition {
  const def = registry.get(kind);
  if (!def) {
    throw new Error(`Unknown job kind: ${kind}`);
  }
  return def;
}

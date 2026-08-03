/**

 Registry mapping a sync domain name to the function that applies one
 decrypted remote value for that domain (task 5.4). This is what lets the
 delta-log router (router.ts) dispatch a pulled/decrypted op to the SAME
 merge logic the Yjs path already uses — `createReplicatedMap` registers its
 internal `projector.handleRemote` here, and `documentReplication.ts`
 (which predates and doesn't use the generic projector) registers its own
 handler. Either way, the router only needs `(key, remote) => Promise<void>`.

*/

export type RemoteHandler = (key: string, remote: unknown) => Promise<void>;

const handlers = new Map<string, RemoteHandler>();

export function registerDomainHandler(domain: string, handler: RemoteHandler): () => void {
  handlers.set(domain, handler);
  return () => {
    if (handlers.get(domain) === handler) handlers.delete(domain);
  };
}

export function getDomainHandler(domain: string): RemoteHandler | undefined {
  return handlers.get(domain);
}

export function __clearDomainHandlersForTest(): void {
  handlers.clear();
}

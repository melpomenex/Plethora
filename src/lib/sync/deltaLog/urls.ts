/**

 Derive the delta-log service's HTTP and WS base URLs from the single
 `settings.sync.yjs.url` endpoint setting (task 7.5 keeps this one setting;
 this helper is what makes "single wss:// value" and "two derived URLs"
 compatible). A `wss://` value derives `https://` for HTTP calls and reuses
 itself for WS; `ws://` (local/dev) derives `http://`.

 Deployment note: this assumes whatever reverse proxy sits in front of that
 hostname routes to the file-service (where syncLog is folded, per this
 change's Phase 3 decision) rather than the old yjs-sync relay — a Caddyfile
 change outside this repo's tracked config.

*/

export interface DeltaLogUrls {
  httpBase: string;
  wsBase: string;
}

export function deriveDeltaLogUrls(wsUrl: string): DeltaLogUrls {
  const trimmed = wsUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("wss://")) {
    return { httpBase: `https://${trimmed.slice("wss://".length)}`, wsBase: trimmed };
  }
  if (trimmed.startsWith("ws://")) {
    return { httpBase: `http://${trimmed.slice("ws://".length)}`, wsBase: trimmed };
  }
  throw new Error(`deriveDeltaLogUrls: unrecognized scheme in "${wsUrl}"`);
}

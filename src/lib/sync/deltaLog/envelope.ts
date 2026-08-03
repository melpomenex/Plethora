/**

 The row envelope carried inside an op's encrypted blob (task 2.4's "op
 blob", task 5.1's transport-neutral projector consumes this on the way
 in). `key_tag` on the wire is opaque per design.md §3, so the domain has to
 travel INSIDE the ciphertext — this is what lets the projector route a
 decrypted op to the right entity handler without the server ever learning
 what changed.

*/

import { encryptState, decryptState, keyTag, type SubKeys } from "../encryption";
import type { DeltaLogOp, DeltaLogOpRow, OpKind } from "./client";
import type { SyncOperationKind } from "../syncJournal";

export interface DeltaLogRowEnvelope {
  domain: string;
  entityKey: string;
  operation: SyncOperationKind;
  row: unknown;
}

/** upsert -> live row (kind 0); delete -> tombstone (kind 1); append/review -> immutable log entry (kind 2, exempt from server compaction). */
export function operationToKind(operation: SyncOperationKind): OpKind {
  if (operation === "upsert") return 0;
  if (operation === "delete") return 1;
  return 2; // "append" | "review"
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function buildOp(
  envelope: DeltaLogRowEnvelope,
  hlc: string,
  subKeys: SubKeys,
): Promise<DeltaLogOp> {
  const tag = await keyTag(envelope.domain, envelope.entityKey, subKeys.roomIndexKey);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ domain: envelope.domain, entityKey: envelope.entityKey, row: envelope.row }),
  );
  const blob = await encryptState(plaintext, subKeys.stateKey);
  return {
    keyTag: bytesToB64(tag),
    hlc,
    kind: operationToKind(envelope.operation),
    blob: bytesToB64(blob),
  };
}

/** Decrypt an op pulled from the server back into its row envelope. Domain/entityKey come from inside the ciphertext, never from key_tag. */
export async function decodeOp(
  op: DeltaLogOpRow,
  subKeys: SubKeys,
): Promise<{ seq: number; hlc: string; kind: OpKind; domain: string; entityKey: string; row: unknown }> {
  const plaintext = await decryptState(b64ToBytes(op.blob), subKeys.stateKey);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
    domain: string;
    entityKey: string;
    row: unknown;
  };
  return { seq: op.seq, hlc: op.hlc, kind: op.kind, domain: parsed.domain, entityKey: parsed.entityKey, row: parsed.row };
}

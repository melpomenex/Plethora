/** C8-T02 network guard: ordinary E2E harness denies external network. */
export function assertLocalUrl(url: string): void {
  const u = new URL(url, 'http://localhost');
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.hostname !== '[::1]') {
    throw new Error(`network-guard: external network denied (${u.hostname})`);
  }
}

export async function guardedFetch(input: string, init?: RequestInit): Promise<Response> {
  assertLocalUrl(input);
  return fetch(input, init);
}

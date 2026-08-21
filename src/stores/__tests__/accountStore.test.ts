import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountStore } from '../accountStore';
import { useDocumentStore } from '../documentStore';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function stubLoginSuccess() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login') || url.endsWith('/v1/auth/register')) {
        return jsonResponse({
          user: { id: 'u-1', email: 'user@example.com', subscriptionTier: 'free' },
          tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
          device: { id: 'dev-1' },
        });
      }
      if (url.endsWith('/v1/auth/devices')) {
        return jsonResponse({ devices: [] });
      }
      if (url.endsWith('/v1/auth/token/refresh')) {
        return jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresIn: 900,
        });
      }
      if (url.endsWith('/v1/auth/logout')) {
        return jsonResponse({ ok: true });
      }
      throw new TypeError('unexpected fetch: ' + url);
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({
    isAuthenticated: false,
    user: null,
    tokens: null,
    devices: [],
    deviceId: null,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AccountStore & Anonymous Invariant', () => {
  it('starts unauthenticated with null user (anonymous default)', () => {
    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.tokens).toBeNull();
    expect(state.devices).toEqual([]);
  });

  it('signs in against the server and populates user session', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123', 'My Laptop');
    const state = useAccountStore.getState();

    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.email).toBe('user@example.com');
    expect(state.tokens).not.toBeNull();
  });

  it('sign-out clears tokens but preserves local document store', async () => {
    // Add a mock document into documentStore
    useDocumentStore.setState({
      documents: [
        {
          id: 'doc-local-1',
          title: 'Preserved Local Note',
          filePath: '/local/note.pdf',
          fileType: 'pdf',
          tags: [],
          dateAdded: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          extractCount: 0,
          learningItemCount: 0,
          priorityRating: 3,
          prioritySlider: 50,
          priorityScore: 50,
          isArchived: false,
          isFavorite: false,
        },
      ],
    });

    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');
    expect(useAccountStore.getState().isAuthenticated).toBe(true);

    // Sign out
    await useAccountStore.getState().signOut(true);
    expect(useAccountStore.getState().isAuthenticated).toBe(false);
    expect(useAccountStore.getState().user).toBeNull();
    expect(useAccountStore.getState().tokens).toBeNull();

    // Invariant: Local documents MUST NOT be deleted or altered
    const docs = useDocumentStore.getState().documents;
    expect(docs.length).toBe(1);
    expect(docs[0].id).toBe('doc-local-1');
    expect(docs[0].title).toBe('Preserved Local Note');
  });

  it('revoking device sets revokedAt timestamp on target device', async () => {
    useAccountStore.setState({
      devices: [
        {
          id: 'dev-1',
          deviceName: 'Work Desktop',
          platform: 'windows',
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
        {
          id: 'dev-2',
          deviceName: 'Phone',
          platform: 'ios',
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ],
    });

    await useAccountStore.getState().revokeDevice('dev-1');
    const devices = useAccountStore.getState().devices;

    const dev1 = devices.find((d) => d.id === 'dev-1');
    const dev2 = devices.find((d) => d.id === 'dev-2');

    expect(dev1?.revokedAt).toBeDefined();
    expect(dev2?.revokedAt).toBeUndefined();
  });
});

describe('Sign-in integrity — no fabricated sessions (Change F §2.1)', () => {
  it('network failure on signIn produces an explicit error and NO session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(
      useAccountStore.getState().signIn('user@example.com', 'password123')
    ).rejects.toThrow(/Could not reach Plethora cloud/);

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.tokens).toBeNull();
    expect(state.error).toMatch(/Could not reach Plethora cloud/);
    // No mock/dev token may exist anywhere in state.
    expect(JSON.stringify(state)).not.toContain('dev-token');
  });

  it('invalid credentials surface the server error without creating a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'invalid_credentials', message: 'Invalid email or password' } },
          false,
          401
        )
      )
    );

    await expect(
      useAccountStore.getState().signIn('user@example.com', 'wrong-password')
    ).rejects.toThrow('Invalid email or password');

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.tokens).toBeNull();
    expect(state.error).toBe('Invalid email or password');
  });

  it('network failure on register produces an explicit error and NO session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(
      useAccountStore.getState().register('new@example.com', 'password123')
    ).rejects.toThrow(/Could not reach Plethora cloud/);

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.tokens).toBeNull();
    expect(JSON.stringify(state)).not.toContain('dev-token');
  });
});

describe('Token refresh & multi-device behavior (Change F §2.3)', () => {
  it('expired access token → silent refresh rotates tokens in place', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');

    await useAccountStore.getState().refresh();

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.tokens?.accessToken).toBe('access-2');
    expect(state.tokens?.refreshToken).toBe('refresh-2');
  });

  it('revoked/invalid refresh token (401) → clean transition to signed-out local mode', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');
    expect(useAccountStore.getState().isAuthenticated).toBe(true);

    // Server rejects the refresh (e.g. family revoked after reuse detection,
    // or session cascade-deleted by account deletion on another device).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'session_revoked', message: 'Session reuse detected.' } },
          false,
          401
        )
      )
    );

    await useAccountStore.getState().refresh();

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.tokens).toBeNull();
    expect(state.user).toBeNull();
  });

  it('refresh network failure keeps the offline session intact', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await useAccountStore.getState().refresh();

    // Genuine offline USAGE of previously-signed-in state stays intact.
    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.tokens?.accessToken).toBe('access-1');
  });

  it('device revocation propagates to the server and updates local registry', async () => {
    const revokeSpy = vi.fn(async (_input?: unknown, _init?: RequestInit) =>
      jsonResponse({ ok: true })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/devices/dev-1/revoke')) {
          return revokeSpy(String(input), init) as unknown as Response;
        }
        return jsonResponse({ ok: true });
      })
    );
    useAccountStore.setState({
      isAuthenticated: true,
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
      devices: [
        {
          id: 'dev-1',
          deviceName: 'Lost Phone',
          platform: 'ios',
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ],
    });

    await useAccountStore.getState().revokeDevice('dev-1');

    expect(revokeSpy).toHaveBeenCalled();
    expect(useAccountStore.getState().devices[0].revokedAt).toBeDefined();
  });
});

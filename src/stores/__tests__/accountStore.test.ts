import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountStore } from '../accountStore';
import { useDocumentStore } from '../documentStore';

const tauriMocks = vi.hoisted(() => ({
  isTauri: false,
  invoke: vi.fn(),
}));

vi.mock('../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/tauri')>();
  return {
    ...actual,
    isTauri: () => tauriMocks.isTauri,
    invoke: tauriMocks.invoke,
  };
});

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
  tauriMocks.isTauri = false;
  tauriMocks.invoke.mockReset();
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

describe('Native account auth IPC contract', () => {
  function stubNativeAuth() {
    tauriMocks.isTauri = true;
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'account_auth_login' || command === 'account_auth_register') {
        return {
          user: { id: 'u-native', email: 'native@example.com', subscriptionTier: 'pro' },
          tokens: { accessToken: 'access-native', refreshToken: 'refresh-native', expiresIn: 900 },
          device: { id: 'dev-native' },
        };
      }
      if (command === 'account_list_devices') return [];
      return {};
    });
  }

  it('uses Tauri camelCase command arguments for login', async () => {
    stubNativeAuth();
    useAccountStore.setState({ deviceId: 'dev-native' });

    await useAccountStore.getState().signIn('native@example.com', 'password123', 'MacBook');

    expect(tauriMocks.invoke).toHaveBeenCalledWith('account_auth_login', {
      email: 'native@example.com',
      password: 'password123',
      // The persisted device identity rides along so the server reuses this
      // install's device row instead of issuing a new one per login.
      deviceId: 'dev-native',
      deviceName: 'MacBook',
      platform: 'desktop',
    });
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      'account_auth_login',
      expect.objectContaining({ device_name: expect.anything() })
    );
  });

  it('uses Tauri camelCase command arguments for registration', async () => {
    stubNativeAuth();

    await useAccountStore.getState().register('native@example.com', 'password123', 'Linux PC');

    expect(tauriMocks.invoke).toHaveBeenCalledWith('account_auth_register', {
      email: 'native@example.com',
      password: 'password123',
      deviceName: 'Linux PC',
      platform: 'desktop',
    });
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


describe('Entitlement-safe startup & refresh (entitlement-persistence change)', () => {
  function futureJwt(secondsFromNow: number): string {
    // header.payload.signature with only the payload mattering for exp decode
    const enc = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
      exp: Math.floor(Date.now() / 1000) + secondsFromNow,
    })}.sig`;
  }

  it('init refreshes an expiring access token BEFORE mirroring the session', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');
    // Simulate relaunch with a token that expired an hour ago.
    useAccountStore.setState({
      tokens: {
        accessToken: futureJwt(-3600),
        refreshToken: 'refresh-1',
        expiresIn: 900,
      },
    });
    tauriMocks.isTauri = true;
    tauriMocks.invoke.mockReset();

    await useAccountStore.getState().init();

    // Token refresh endpoint was hit (rotating the expired token)…
    const mirror = tauriMocks.invoke.mock.calls.find(
      (call) => call[0] === 'account_sync_session',
    );
    expect(mirror).toBeDefined();
    // …and the mirrored session carries the ROTATED token, not the expired one.
    const mirroredTokens = (mirror?.[1] as { tokens: { access_token: string } }).tokens;
    expect(mirroredTokens.access_token).toBe('access-2');
  });

  it('init skips the token refresh when the access token is still fresh', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');
    useAccountStore.setState({
      tokens: {
        accessToken: futureJwt(600),
        refreshToken: 'refresh-1',
        expiresIn: 900,
      },
    });
    tauriMocks.isTauri = true;
    tauriMocks.invoke.mockReset();

    const fetchSpy = vi.fn(async () =>
      jsonResponse({ accessToken: 'should-not-happen', refreshToken: 'x', expiresIn: 900 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await useAccountStore.getState().init();

    expect(fetchSpy).not.toHaveBeenCalled();
    const mirror = tauriMocks.invoke.mock.calls.find(
      (call) => call[0] === 'account_sync_session',
    );
    const mirroredTokens = (mirror?.[1] as { tokens: { access_token: string } }).tokens;
    expect(mirroredTokens.access_token).toContain('eyJ');
  });

  it('a bare 401 that is not the API error shape keeps the session (captive portal)', async () => {
    stubLoginSuccess();
    await useAccountStore.getState().signIn('user@example.com', 'password123');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('<html>Login to this network</html>', false, 401)),
    );

    await useAccountStore.getState().refresh();

    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.tokens?.refreshToken).toBe('refresh-1');
  });

  it('signOut resets the entitlement snapshot to canonical Free defaults', async () => {
    stubLoginSuccess();
    // Pro login seeds the optimistic auth-verified snapshot.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          user: { id: 'u-1', email: 'user@example.com', subscriptionTier: 'pro' },
          tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
          device: { id: 'dev-1' },
        }),
      ),
    );
    await useAccountStore.getState().signIn('user@example.com', 'password123');

    const { useEntitlementStore } = await import('../entitlementStore');
    expect(useEntitlementStore.getState().snapshot.plan).toBe('pro');

    await useAccountStore.getState().signOut();

    expect(useEntitlementStore.getState().snapshot.plan).toBe('free');
    expect(useEntitlementStore.getState().snapshot.source).toBe('local_defaults');
    expect(useEntitlementStore.getState().snapshot.capabilities.cloud_sync.enabled).toBe(false);
  });

  it('a Pro login seeds an optimistic auth-verified snapshot (source cache)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          user: { id: 'u-1', email: 'user@example.com', subscriptionTier: 'pro' },
          tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
          device: { id: 'dev-1' },
        }),
      ),
    );
    await useAccountStore.getState().signIn('user@example.com', 'password123');

    const { useEntitlementStore } = await import('../entitlementStore');
    const snapshot = useEntitlementStore.getState().snapshot;
    expect(snapshot.plan).toBe('pro');
    expect(snapshot.source).toBe('cache');
    expect(snapshot.accountId).toBe('u-1');
  });
});

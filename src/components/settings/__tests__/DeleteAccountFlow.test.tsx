import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteAccountFlow } from '../DeleteAccountFlow';
import { useAccountStore } from '../../../stores/accountStore';
import { useSyncStore } from '../../../stores/syncStore';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

async function signInFixture() {
  useAccountStore.setState({
    isAuthenticated: true,
    user: { id: 'u1', email: 'user@example.com', subscriptionTier: 'free' },
    tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
    deviceId: 'dev-1',
    devices: [],
    loading: false,
    error: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ success: false }))
  );
  signInFixture();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openFlow() {
  return render(<DeleteAccountFlow open onClose={() => {}} />);
}

describe('DeleteAccountFlow (Change F §1.1/§1.2)', () => {
  it('describes scope in plain language: cloud deleted, local retained, Apple subscription NOT cancelled', () => {
    openFlow();
    expect(screen.getByText(/Delete your Plethora account\?/)).toBeTruthy();
    expect(screen.getByText(/Your local library — documents, notes, and flashcards on this device stay/)).toBeTruthy();
    expect(screen.getByText(/Apple subscription — if you subscribed via Apple, billing continues until you/)).toBeTruthy();
  });

  it('offers export-before-delete wired to GET /v1/auth/export', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/auth/export')) {
        return jsonResponse({ exportVersion: '1.0', user: null });
      }
      return jsonResponse({ success: false }, false, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    openFlow();
    fireEvent.click(screen.getByText('Export my cloud data first'));
    await waitFor(() => {
      expect(screen.getByText(/Export downloaded/)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/export'),
      expect.objectContaining({ headers: { Authorization: 'Bearer access-1' } })
    );
  });

  it('requires explicit typed confirmation before deleting', () => {
    openFlow();
    fireEvent.click(screen.getByText('Continue'));
    const deleteButton = screen.getByText('Delete my account permanently') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    const input = screen.getByLabelText('Type DELETE to confirm') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'delete' } });
    expect((screen.getByText('Delete my account permanently') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect((screen.getByText('Delete my account permanently') as HTMLButtonElement).disabled).toBe(false);
  });

  it('on confirmed server success: signs out, disables sync cleanly, shows unambiguous success copy', async () => {
    useSyncStore.setState({
      isSyncing: true,
      lastSyncedAt: '2026-08-20T00:00:00Z',
      pendingOutboxCount: 3,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, deletedAt: '2026-08-21T00:00:00Z' }))
    );

    openFlow();
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByText('Delete my account permanently'));

    await waitFor(() => {
      expect(screen.getByText('Account deleted')).toBeTruthy();
    });
    expect(      screen.getByText(/continues to bill until you cancel it in Apple Settings/)).toBeTruthy();

    const account = useAccountStore.getState();
    expect(account.isAuthenticated).toBe(false);
    expect(account.tokens).toBeNull();

    const sync = useSyncStore.getState();
    expect(sync.isSyncing).toBe(false);
    expect(sync.lastSyncedAt).toBeNull();
    expect(sync.pendingOutboxCount).toBe(0);
  });

  it('on API failure: explicit error + retry, user REMAINS signed in, no silent sign-out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'deletion_failed', message: 'Database unavailable' } },
          false,
          500
        )
      )
    );

    openFlow();
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByText('Delete my account permanently'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText('Deletion failed')).toBeTruthy();
    expect(screen.getByText('Retry deletion')).toBeTruthy();

    // Critical invariant: failure must never sign the user out.
    expect(useAccountStore.getState().isAuthenticated).toBe(true);
    expect(useAccountStore.getState().tokens?.accessToken).toBe('access-1');
  });

  it('retry after failure re-attempts the deletion request', async () => {
    let deleteAttempts = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') deleteAttempts += 1;
      if (deleteAttempts === 1) {
        return jsonResponse({ error: { code: 'deletion_failed', message: 'boom' } }, false, 500);
      }
      return jsonResponse({ success: true, deletedAt: '2026-08-21T00:00:00Z' });
    });
    vi.stubGlobal('fetch', fetchMock);

    openFlow();
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByText('Delete my account permanently'));
    await waitFor(() => expect(screen.getByText('Retry deletion')).toBeTruthy());

    fireEvent.click(screen.getByText('Retry deletion'));
    // Back on the confirm step; confirm again.
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByText('Delete my account permanently'));
    await waitFor(() => expect(screen.getByText('Account deleted')).toBeTruthy());
    expect(deleteAttempts).toBe(2);
  });
});

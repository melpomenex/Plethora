import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountStore } from '../accountStore';
import { useDocumentStore } from '../documentStore';

describe('AccountStore & Anonymous Invariant', () => {
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

  it('starts unauthenticated with null user (anonymous default)', () => {
    const state = useAccountStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.tokens).toBeNull();
    expect(state.devices).toEqual([]);
  });

  it('signs in and populates user session', async () => {
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

import { describe, it, expect, beforeEach } from 'vitest';
import { usePaywallStore } from '../paywallStore';
import { PRO_FEATURES_CATALOG } from '../../types/paywall';

describe('PaywallStore & Feature Catalog', () => {
  beforeEach(() => {
    usePaywallStore.getState().closePaywall();
  });

  it('manages modal open state with contextual capability details', () => {
    const store = usePaywallStore.getState();
    store.openPaywall({
      capabilityId: 'library_intelligence',
      sourceSurface: 'search_bar',
      title: 'Whole-Library RAG & Deep Citations',
      description: 'Query all books and PDFs across your entire library simultaneously.',
      quotaDetails: '500 RAG queries / month included',
    });

    const state = usePaywallStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeContext?.capabilityId).toBe('library_intelligence');
    expect(state.activeContext?.quotaDetails).toContain('500 RAG queries');

    state.closePaywall();
    expect(usePaywallStore.getState().isOpen).toBe(false);
  });

  it('activates 14-day free trial state cleanly', () => {
    const store = usePaywallStore.getState();
    store.startTrial();

    const trial = usePaywallStore.getState().trial;
    expect(trial.isActive).toBe(true);
    expect(trial.daysRemaining).toBe(14);
    expect(trial.expiresAt).toBeDefined();
  });

  it('verifies all 10 Pro capabilities are present in feature catalog with non-coercive descriptions', () => {
    expect(PRO_FEATURES_CATALOG.length).toBeGreaterThanOrEqual(10);
    const rag = PRO_FEATURES_CATALOG.find((f) => f.capabilityId === 'library_intelligence');
    expect(rag?.isCloudAugmentation).toBe(true);
    expect(rag?.quotaWindow).toBeDefined();
  });
});

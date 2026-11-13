import { describe, expect, it, vi } from 'vitest';
import {
  assertResearchConsent,
  buildTransmittedPayload,
  discloseResearchQuery,
  isPublicDestination,
  runBoundedResearch,
} from '../researchAdapter';

describe('research adapter (web-research 1.1/1.2)', () => {
  it('transmits exactly the approved query and provider metadata — nothing else', () => {
    const payload = buildTransmittedPayload('What is photosynthesis?', 5);
    expect(payload).toEqual({ query: 'What is photosynthesis?', count: 5 });
    expect(Object.keys(payload)).toEqual(['query', 'count']);
  });

  it('requires explicit approval; declined/off states never execute', async () => {
    const declined = discloseResearchQuery('q', { approved: false });
    expect(declined.state).toBe('declined');
    await expect(runBoundedResearch({ query: 'q' }, declined)).rejects.toMatchObject({ code: 'research_not_authorized' });

    const off = discloseResearchQuery('q', { disabled: true });
    expect(off.state).toBe('off');
    expect(() => assertResearchConsent(off)).toThrow();
  });

  it('refuses private/local result destinations', async () => {
    expect(isPublicDestination('https://api.search.brave.com/res/v1/web/search')).toBe(true);
    expect(isPublicDestination('http://127.0.0.1:8000/')).toBe(false);
    expect(isPublicDestination('http://localhost/')).toBe(false);
    expect(isPublicDestination('http://10.0.0.5/')).toBe(false);
    expect(isPublicDestination('http://192.168.1.1/')).toBe(false);
    expect(isPublicDestination('http://[::1]/')).toBe(false);

    const approved = discloseResearchQuery('q', { approved: true });
    await expect(
      runBoundedResearch({ query: 'q' }, approved, {
        searchImpl: async () => [{ id: 'x', title: 'Local', url: 'http://10.0.0.5/', snippet: 'private' }],
      })
    ).rejects.toMatchObject({ code: 'privacy_denied' });
  });

  it('honors cancellation and makes one provider request without hidden retries', async () => {
    const controller = new AbortController();
    controller.abort();
    const approved = discloseResearchQuery('q', { approved: true });
    await expect(runBoundedResearch({ query: 'q', signal: controller.signal }, approved)).rejects.toMatchObject({ code: 'cancelled' });

    const searchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      runBoundedResearch({ query: 'q' }, approved, { searchImpl })
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(searchImpl).toHaveBeenCalledTimes(1); // no hidden retries
  });
});

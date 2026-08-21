import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeCloudAiDisclosure,
  ensureCloudAiDisclosure,
  getAcknowledgedProviderClass,
  isCloudAiDisclosed,
  resetCloudAiDisclosure,
  resolveCloudAiProviderClass,
  setCloudAiDisclosurePresenter,
} from '../cloudAiDisclosure';

function presenterStub(accept: boolean) {
  return vi.fn(async () => accept);
}

beforeEach(() => {
  localStorage.clear();
  resetCloudAiDisclosure();
  setCloudAiDisclosurePresenter(null);
});

describe('cloud-AI first-use disclosure gate (Change C §4.2)', () => {
  it('local providers never trigger the disclosure', async () => {
    const presenter = presenterStub(true);
    setCloudAiDisclosurePresenter(presenter);
    await expect(
      ensureCloudAiDisclosure({ featureClass: 'tts', provider: 'system', isLocal: true })
    ).resolves.toBe(true);
    expect(presenter).not.toHaveBeenCalled();
    expect(getAcknowledgedProviderClass()).toBeNull();
  });

  it('prompts once per provider class and persists acceptance', async () => {
    const presenter = presenterStub(true);
    setCloudAiDisclosurePresenter(presenter);

    await expect(
      ensureCloudAiDisclosure({ featureClass: 'ai_actions', provider: 'openai' })
    ).resolves.toBe(true);
    expect(presenter).toHaveBeenCalledTimes(1);
    expect(getAcknowledgedProviderClass()).toBe('byo-key');

    // Same class, different feature: no re-prompt ("don't ask again" honored).
    await expect(
      ensureCloudAiDisclosure({ featureClass: 'embeddings', provider: 'cohere' })
    ).resolves.toBe(true);
    expect(presenter).toHaveBeenCalledTimes(1);
  });

  it('re-prompts when the provider class changes', async () => {
    const presenter = presenterStub(true);
    setCloudAiDisclosurePresenter(presenter);

    await ensureCloudAiDisclosure({ featureClass: 'tts', provider: 'openai' });
    expect(getAcknowledgedProviderClass()).toBe('byo-key');

    // Switching to the Plethora-hosted class re-prompts once.
    await expect(
      ensureCloudAiDisclosure({ featureClass: 'embeddings', provider: 'plethora' })
    ).resolves.toBe(true);
    expect(presenter).toHaveBeenCalledTimes(2);
    expect(getAcknowledgedProviderClass()).toBe('plethora-hosted');

    await ensureCloudAiDisclosure({ featureClass: 'ai_actions', provider: 'plethora' });
    expect(presenter).toHaveBeenCalledTimes(2);
  });

  it('a denial does not persist; no presenter proceeds without persisting', async () => {
    const deny = presenterStub(false);
    setCloudAiDisclosurePresenter(deny);

    await expect(
      ensureCloudAiDisclosure({ featureClass: 'transcription', provider: 'groq' })
    ).resolves.toBe(false);
    expect(isCloudAiDisclosed('byo-key')).toBe(false);

    // No presenter registered (headless/test context): the operation may
    // proceed but nothing is acknowledged, so a later presenter still asks.
    setCloudAiDisclosurePresenter(null);
    await expect(
      ensureCloudAiDisclosure({ featureClass: 'transcription', provider: 'groq' })
    ).resolves.toBe(true);
    expect(getAcknowledgedProviderClass()).toBeNull();
  });

  it('degrades to asking every session when persistence fails', async () => {
    const presenter = presenterStub(true);
    setCloudAiDisclosurePresenter(presenter);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    await expect(
      ensureCloudAiDisclosure({ featureClass: 'ai_actions', provider: 'anthropic' })
    ).resolves.toBe(true);
    // Acceptance could not be persisted → asks again next time.
    await expect(
      ensureCloudAiDisclosure({ featureClass: 'ai_actions', provider: 'anthropic' })
    ).resolves.toBe(true);
    expect(presenter).toHaveBeenCalledTimes(2);
    setItemSpy.mockRestore();
  });

  it('corrupt or foreign persisted records are ignored', () => {
    localStorage.setItem('plethora.privacy.cloudAiDisclosure.v1', JSON.stringify({ providerClass: 'bogus' }));
    expect(getAcknowledgedProviderClass()).toBeNull();
    localStorage.setItem('plethora.privacy.cloudAiDisclosure.v1', 'not json{');
    expect(isCloudAiDisclosed('byo-key')).toBe(false);
  });

  it('classifies only the Plethora-hosted destination as its own class', () => {
    expect(resolveCloudAiProviderClass('plethora')).toBe('plethora-hosted');
    for (const p of ['openai', 'anthropic', 'deepseek', 'openrouter', 'groq', 'cohere']) {
      expect(resolveCloudAiProviderClass(p)).toBe('byo-key');
    }
  });

  it('explicit acknowledgment API round-trips', () => {
    acknowledgeCloudAiDisclosure('plethora-hosted');
    expect(isCloudAiDisclosed('plethora-hosted')).toBe(true);
    expect(isCloudAiDisclosed('byo-key')).toBe(false);
    resetCloudAiDisclosure();
    expect(getAcknowledgedProviderClass()).toBeNull();
  });
});

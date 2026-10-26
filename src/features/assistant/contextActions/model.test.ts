import { describe, expect, it } from 'vitest';
import { CONTEXT_ACTIONS, actionBlockReason, buildActionPrompt, captureAction, isolateCardActionCalls, isolateCardActionParameters, parseQuizQuestion, restoreActionEnvelope, type ActionTarget } from './model';
import { actionSourceIdentity, resolveActionTargets } from './targets';
import { createSelectionAskSnapshot } from '../../../utils/selectionAskHandoff';
import { buildSectionsSnapshot } from '../../../utils/sectionIndex';
import { en } from '../../../lib/i18n/locales/en';
import { de } from '../../../lib/i18n/locales/de';
import { es } from '../../../lib/i18n/locales/es';
import { fr } from '../../../lib/i18n/locales/fr';
import { ja } from '../../../lib/i18n/locales/ja';
import { zh } from '../../../lib/i18n/locales/zh';
const context = { type: 'document' as const, documentId: 'a', content: 'Canonical body', metadata: { title: 'Source A' } };
const source: ActionTarget = { key: 'a', owner: 'document:a', kind: 'selection', sourceType: 'document', content: 'Selected facts', coverage: 'window', labelKey: 'selection', documentId: 'a', title: 'Source A' };
const resolve = (overrides: Partial<Parameters<typeof resolveActionTargets>[0]> = {}) => resolveActionTargets({ context, sections: [], messages: [], ...overrides });

describe('context action contracts', () => {
  it('defines all ten actions in stable primary order with scoped outcomes', () => {
    expect(CONTEXT_ACTIONS.map(a => a.id)).toEqual(['summarize','explain','quiz','key-points','key-terms','translate','outline-document','example','analyze-argument','flashcards']);
    for (const a of CONTEXT_ACTIONS) {
      expect(a.toolPolicy).toBe(a.id === 'flashcards' ? 'cards' : 'read-only');
      for (const scope of ['chat','document','library'] as const) {
        const options = { scope, target: source, fullTarget: { ...source, kind: 'document' as const }, providerReady: true };
        expect(actionBlockReason(a, options)).toBe(a.id === 'example' && scope !== 'chat' ? 'useChat' : undefined);
        expect(actionBlockReason(a, { ...options, providerReady: false })).toBe('noProvider');
        expect(actionBlockReason(a, { ...options, target: undefined, fullTarget: undefined })).toBe(a.id === 'example' && scope !== 'chat' ? 'useChat' : a.wholeSource ? 'noDocument' : 'noTarget');
      }
    }
  });
  it('requires a bounded translation target and explicit mismatch resolution', () => {
    const translate = CONTEXT_ACTIONS.find(a => a.id === 'translate')!;
    expect(actionBlockReason(translate, { target: { ...source, kind: 'document' }, scope: 'chat', providerReady: true })).toBe('selectPassage');
    expect(actionBlockReason(CONTEXT_ACTIONS[0], { target: source, scope: 'chat', providerReady: true, mismatch: true })).toBe('chooseTarget');
  });
  it('captures immutable target, parameters and excluded questions', () => {
    const excluded = ['Old question?'];
    const original = { ...source };
    const action = captureAction('quiz', original, 'document', { excludedQuestions: excluded });
    original.content = 'new'; excluded.push('new');
    expect(action.target.content).toBe('Selected facts');
    expect(action.parameters.excludedQuestions).toEqual(['Old question?']);
    expect(Object.isFrozen(action)).toBe(true);
    expect(restoreActionEnvelope(JSON.parse(JSON.stringify(action)))).toEqual(action);
    expect(restoreActionEnvelope({ ...action, version: 2 })).toBeUndefined();
    expect(restoreActionEnvelope({ ...action, target: { ...source, content: null } })).toBeUndefined();
  });
  it.each(CONTEXT_ACTIONS)('builds deterministic scoped prompts for $id', a => {
    const action = captureAction(a.id, source, 'document', { language: 'ja', excludedQuestions: ['Old?'] });
    expect(buildActionPrompt(action, 'de')).toBe(buildActionPrompt(action, 'de'));
    expect(buildActionPrompt(action, 'de')).toContain('Respond in language ja');
    expect(buildActionPrompt(action, 'de')).toContain(a.id === 'example' ? 'illustrative' : 'supplied');
    if (a.id === 'flashcards') expect(buildActionPrompt(action, 'de')).toMatch(/^\/20rules/);
  });
  it('validates structured quiz output and starts both reveals hidden', () => {
    expect(parseQuizQuestion('```json\n{"question":"Why?","answer":"Because","hint":"Think"}\n```')).toEqual({ question: 'Why?', answer: 'Because', hint: 'Think', answerRevealed: false, hintRevealed: false });
    for (const raw of ['text with exposed answer', '{}', '[]', '{"question":"Q","answer":""}', '{"question":"Q","answer":"A","hint":4}']) expect(parseQuizQuestion(raw)).toBeUndefined();
  });
  it('splits batch cards before writes so per-card retries cannot replay successes', () => {
    const calls = isolateCardActionCalls([{ name: 'batch_create_cards', status: 'pending' as const, parameters: { tags: ['shared'], cards: [{ type: 'qa', question: 'Q', answer: 'A' }, { type: 'cloze', question: '{{C}}' }] } }]);
    expect(calls.map(c => c.name)).toEqual(['create_qa_card','create_cloze_card']);
    expect(calls[1].parameters).toMatchObject({ text: '{{C}}', tags: ['shared'] });
    expect(isolateCardActionCalls([{ name: 'create_extract', parameters: {}, status: 'pending' }])).toEqual([]);
  });
  it('removes model-proposed source and deck associations before applying the captured identity', () => {
    expect(isolateCardActionParameters({ document_id: 'other', source: { documentId: 'other' }, deck_id: 'other', tags: ['topic', 'deck:Other'], question: 'Q' })).toEqual({ tags: ['topic'], question: 'Q' });
  });
  it('translates every complete action key in all supported locales', () => {
    const keys = Object.keys(en).filter(k => k.startsWith('assistant.actions.'));
    for (const dictionary of [de, es, fr, ja, zh]) {
      for (const key of keys) expect(dictionary[key], key).toBeTruthy();
      expect(dictionary['assistant.actions.summarize']).not.toBe(en['assistant.actions.summarize']);
      expect(dictionary['assistant.actions.target.selection']).not.toBe(en['assistant.actions.target.selection']);
    }
  });
});

describe('deterministic targets', () => {
  it('prefers live, then pin, then sections, then focused window, then whole source', () => {
    const pin = createSelectionAskSnapshot('Pinned', { documentId: 'a' });
    const sections = buildSectionsSnapshot('a', '# Heading\nSection facts', undefined).flat.slice(0, 1);
    const focused = { ...context, content: 'Nearby source', source: 'pdf-window', coverage: 'window' as const, selection: 'Live', position: { pageNumber: 42 } };
    expect(resolve({ context: focused, pin, sections }).target).toMatchObject({ kind: 'selection', content: 'Live', locator: 'p. 42' });
    expect(resolve({ context: { ...focused, selection: undefined }, pin, sections }).target?.content).toBe('Pinned');
    expect(resolve({ context: { ...focused, selection: undefined }, sections }).target?.kind).toBe('sections');
    const resolution = resolve({ context: { ...focused, selection: undefined } });
    expect(resolution.target).toMatchObject({ kind: 'passage', labelKey: 'pages', coverage: 'window' });
    expect(resolution.fullTarget?.content).toBe('');
    expect(resolve().target).toMatchObject({ kind: 'document', labelKey: 'document' });
  });
  it('keeps supplied excerpts available for honest partial outlines of ephemeral sources', () => {
    const result = resolve({ context: { type: 'web', url: 'https://example.test/article', content: 'A supplied excerpt', coverage: 'window' } });
    expect(result.fullTarget).toMatchObject({ content: 'A supplied excerpt', coverage: 'window', kind: 'document' });
  });
  it('requires a target choice for an old source and resets manual choice after switch/detach', () => {
    const pin = createSelectionAskSnapshot('Old source quote', { documentId: 'b', documentTitle: 'B' });
    const result = resolve({ pin });
    expect(result.mismatch).toBe(true);
    const manual = { owner: actionSourceIdentity(context), key: result.fullTarget!.key };
    expect(resolve({ pin, manual }).mismatch).toBe(false);
    expect(resolve({ pin, manual, context: { ...context, documentId: 'c' } }).mismatch).toBe(true);
    expect(resolve({ pin, manual, context: undefined }).target).toBeUndefined();
  });
  it('labels full and bounded media honestly and never promotes greeting/status threads', () => {
    const full = resolve({ context: { ...context, type: 'video', source: 'video-transcript' } });
    expect(full.target?.labelKey).toBe('transcript');
    expect(resolve({ context: { ...context, type: 'video', coverage: 'window' } }).target?.labelKey).toBe('segment');
    expect(resolve({ context: undefined, messages: [{ id: '1', role: 'assistant', content: 'Hello, how can I help you understand your reading today?' }] }).target).toBeUndefined();
    const messages = [{ id: '1', role: 'assistant' as const, content: 'Cells convert chemical energy into ATP to power their internal processes.' }];
    expect(resolve({ context: undefined, messages }).target?.kind).toBe('conversation');
    expect(resolve({ messages }).target?.kind).toBe('document');
  });
});

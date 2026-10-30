import { expect, test } from '@playwright/test';

test('canonical card creation preserves lineage, partial receipts, and retry identities in IndexedDB', async ({ page }) => {
  await page.goto('/src/lib/marketingCapture/namespace.ts');
  const result = await page.evaluate(async () => {
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = 'plethora-marketing-capture-v2-0000000000000013';
    const fixturePath = '/src/test/issue6/browserFixture.ts';
    const tauriPath = '/src/lib/tauri.ts';
    const databasePath = '/src/lib/database.ts';
    const sourcePath = '/src/lib/ai/assistant/sourceEnvelope.ts';
    const { recreateIssue6BrowserFixture } = await import(/* @vite-ignore */ fixturePath);
    await recreateIssue6BrowserFixture();
    const { invokeCommand: run } = await import(/* @vite-ignore */ tauriPath);
    const db = await import(/* @vite-ignore */ databasePath);
    const { resolveAssistantSource } = await import(/* @vite-ignore */ sourcePath);
    const source = await resolveAssistantSource({ documentId: 'extract:issue6-extract' });
    const call = async (arguments_: Record<string, unknown>) => {
      const result = await run('mcp_call_app_tool', { toolName: 'batch_create_cards', arguments: arguments_ });
      return JSON.parse(result.content[0].text);
    };
    const args = { document_id: source.documentId, extract_id: source.extractId, acceptance_id: 'turn-13', cards: [
      { type: 'qa', question: 'What persisted source owns this card?', answer: 'The actual parent' },
      { type: 'cloze', question: 'The {{c1::canonical answer}} stays linked.' },
      { type: 'unsupported', question: 'Reject this candidate', answer: 'No row' },
    ] };
    const first = await call(args);
    db.closeDatabase();
    const replay = await call(args);
    const cards = await db.getLearningItems();
    const parent = await db.getDocument(source.documentId);
    const beforeFailure = parent.learning_item_count;
    let rejected = false;
    try {
      await db.createLearningItemsAtomic([
        { id: 'must-rollback', document_id: source.documentId, item_type: 'qa', question: 'Tentative', answer: 'A' },
        { id: 'invalid-source', document_id: 'missing', item_type: 'qa', question: 'Invalid', answer: 'B' },
      ]);
    } catch { rejected = true; }
    const rolledBack = await db.getLearningItem('must-rollback');
    const afterFailure = await db.getDocument(source.documentId);
    let conflict = false;
    const changed = structuredClone(args); changed.cards[0].question = 'Changed identity payload';
    const conflicting = await call(changed);
    conflict = conflicting.results[0].success === false;
    let stale = false;
    try {
      await run('create_learning_item', { itemType: 'qa', question: 'Stale source candidate?', answer: 'A',
        documentId: source.documentId, sourceRevision: 'stale-revision', allowDuplicate: true });
    } catch { stale = true; }
    await db.deleteDocument(source.documentId);
    let deletedSource = false;
    try { await resolveAssistantSource({ documentId: source.documentId }); } catch { deletedSource = true; }
    return { source, first, replay, cards, parent, beforeFailure, afterFailure, rejected, rolledBack, conflict, stale, deletedSource };
  });
  expect(result.source).toMatchObject({ documentId: 'issue6-document', extractId: 'issue6-extract' });
  expect(result.first).toMatchObject({ attempted: 3, created: 2, failed: 1 });
  expect(result.replay.results.map((row: { id?: string }) => row.id)).toEqual(result.first.results.map((row: { id?: string }) => row.id));
  expect(result.cards).toHaveLength(6);
  expect(result.parent.learning_item_count).toBe(6);
  const cloze = result.cards.find((card: { acceptance_id?: string; item_type: string }) => card.acceptance_id === 'turn-13' && card.item_type === 'cloze');
  expect(cloze).toMatchObject({ document_id: 'issue6-document', extract_id: 'issue6-extract', cloze_text: 'The {{c1::canonical answer}} stays linked.' });
  expect(result.rejected).toBe(true);
  expect(result.rolledBack).toBeNull();
  expect(result.afterFailure.learning_item_count).toBe(result.beforeFailure);
  expect(result.conflict).toBe(true);
  expect(result.stale).toBe(true);
  expect(result.deletedSource).toBe(true);
});

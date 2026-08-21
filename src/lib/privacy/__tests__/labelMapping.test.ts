import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivacyLabelDraft } from '../labelMapping';
import { getAllDisclosures } from '../disclosureRegistry';

describe('ASC privacy-label draft generator (Change C §3.2)', () => {
  it('produces a stable questionnaire draft from the registry (snapshot)', () => {
    const draft = generatePrivacyLabelDraft();
    expect(draft).toMatchSnapshot();
  });

  it('folds per-disclosure mappings into deduplicated ASC rows', () => {
    const draft = generatePrivacyLabelDraft();

    // user_content is collected by many flows; must appear exactly once.
    const userContent = draft.collectedData.filter((r) => r.dataType === 'user_content');
    expect(userContent).toHaveLength(1);
    // Multiple contributing disclosures are traced on the row.
    expect(userContent[0].sourceDisclosureIds.length).toBeGreaterThan(1);
    expect(userContent[0].purposes).toContain('app_functionality');

    // purchases row exists only because of store_transactions.
    const purchases = draft.collectedData.find((r) => r.dataType === 'purchases');
    expect(purchases).toBeDefined();
    expect(purchases!.sourceDisclosureIds).toEqual(['store_transactions']);
    expect(purchases!.linkedToIdentity).toBe(true);

    // usage_data comes only from web_analytics and is NOT linked to identity.
    const usage = draft.collectedData.find((r) => r.dataType === 'usage_data');
    expect(usage).toBeDefined();
    expect(usage!.sourceDisclosureIds).toEqual(['web_analytics']);
    expect(usage!.linkedToIdentity).toBe(false);

    // Nothing in Plethora tracks.
    for (const row of draft.collectedData) {
      expect(row.usedForTracking).toBe(false);
    }
  });

  it('every registry id appears in the mapping document (docs stay in sync)', () => {
    const docPath = join(__dirname, '..', '..', '..', '..', 'docs', 'release', 'ios-privacy-labels.md');
    const content = readFileSync(docPath, 'utf8');
    for (const d of getAllDisclosures()) {
      expect(content).toContain(d.id);
    }
  });
});

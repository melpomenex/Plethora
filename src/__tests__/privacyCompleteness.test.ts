import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISCLOSURE_REGISTRY,
  getAllDisclosures,
  getDisclosure,
} from '../lib/privacy/disclosureRegistry';
import { isCloudEligible } from '../types/privacy';
import type { Document } from '../types/document';

describe('Privacy & Disclosure Registry Completeness', () => {
  it('all disclosure entries have complete required metadata', () => {
    const disclosures = getAllDisclosures();
    expect(disclosures.length).toBeGreaterThanOrEqual(8);

    for (const d of disclosures) {
      expect(d.id).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.category).toBeTruthy();
      expect(typeof d.dataLeavesDevice).toBe('boolean');
      expect(d.trigger).toBeTruthy();
      expect(d.destination).toBeTruthy();
      expect(d.retention).toBeTruthy();
      expect(d.encryptionState).toBeTruthy();
      expect(d.thirdPartyInvolvement).toBeTruthy();
      expect(typeof d.userDeletable).toBe('boolean');
      expect(d.localFallback).toBeTruthy();
      expect(d.description).toBeTruthy();
    }
  });

  it('getDisclosure finds entries by ID', () => {
    const sync = getDisclosure('cloud_sync');
    expect(sync).toBeDefined();
    expect(sync?.encryptionState).toBe('e2e_encrypted');
  });

  it('isCloudEligible enforces the local-only shield', () => {
    expect(isCloudEligible(null)).toBe(false);
    expect(isCloudEligible(undefined)).toBe(false);

    const normalDoc: Document = {
      id: 'doc-1',
      title: 'Public Research Paper',
      filePath: '/path/paper.pdf',
      fileType: 'pdf',
      tags: ['ai', 'research'],
      dateAdded: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 3,
      prioritySlider: 50,
      priorityScore: 50,
      isArchived: false,
      isFavorite: false,
    };
    expect(isCloudEligible(normalDoc)).toBe(true);

    const localOnlyDoc: Document = {
      ...normalDoc,
      id: 'doc-2',
      title: 'Confidential Journal',
      isLocalOnly: true,
    };
    expect(isCloudEligible(localOnlyDoc)).toBe(false);

    const metadataLocalOnlyDoc: Document = {
      ...normalDoc,
      id: 'doc-3',
      title: 'Private Notes',
      metadata: {
        isLocalOnly: true,
      },
    };
    expect(isCloudEligible(metadataLocalOnlyDoc)).toBe(false);
  });

  it('docs/PRIVACY_ARCHITECTURE.md documents every registered feature ID', () => {
    const docPath = join(__dirname, '..', '..', 'docs', 'PRIVACY_ARCHITECTURE.md');
    expect(existsSync(docPath)).toBe(true);

    const content = readFileSync(docPath, 'utf8');
    for (const d of getAllDisclosures()) {
      expect(content).toContain(d.id);
    }
  });
});

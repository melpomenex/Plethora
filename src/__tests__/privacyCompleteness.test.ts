import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
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

  // ── Change C task 1.3: label-mapping fields + behavior-truthing spot checks ──

  it('every egress disclosure carries a complete App Store label mapping', () => {
    for (const d of getAllDisclosures()) {
      const lm = d.labelMapping;
      expect(lm, `labelMapping missing on ${d.id}`).toBeDefined();
      expect(Array.isArray(lm.dataTypes)).toBe(true);
      expect(typeof lm.linkedToIdentity).toBe('boolean');
      expect(lm.usedForTracking).toBe(false); // Plethora never tracks
      expect(Array.isArray(lm.purposes)).toBe(true);
      if (d.dataLeavesDevice) {
        expect(lm.dataTypes.length, `${d.id} egresses but declares no ASC data types`).toBeGreaterThan(0);
        expect(lm.purposes.length, `${d.id} egresses but declares no ASC purposes`).toBeGreaterThan(0);
      } else {
        expect(lm.dataTypes.length).toBe(0);
      }
    }
  });

  it('store_transactions matches Proposal B documented flows (non-deletable minimal records)', () => {
    const tx = getDisclosure('store_transactions');
    expect(tx).toBeDefined();
    expect(tx!.dataLeavesDevice).toBe(true);
    expect(tx!.destination).toContain('StoreKit');
    expect(tx!.encryptionState).toBe('in_transit_tls');
    // Minimal financial records retained for accounting/refunds — documented rationale.
    expect(tx!.userDeletable).toBe(false);
    expect(tx!.labelMapping.dataTypes).toContain('purchases');
    expect(tx!.description.toLowerCase()).toContain('signed transaction');
  });

  it('web_analytics covers Vercel Analytics and is scoped to web/PWA builds', () => {
    const web = getDisclosure('web_analytics');
    expect(web).toBeDefined();
    expect(web!.destination).toContain('Vercel');
    expect(web!.description).toMatch(/web\/PWA/i);
    expect(web!.labelMapping.usedForTracking).toBe(false);
    expect(web!.labelMapping.linkedToIdentity).toBe(false);
  });

  it('telemetry_crash_reporting matches shipped reality: no crash SDK, zero egress', () => {
    const tel = getDisclosure('telemetry_crash_reporting');
    expect(tel).toBeDefined();
    expect(tel!.dataLeavesDevice).toBe(false);
    expect(tel!.trigger).toBe('never');
    expect(tel!.labelMapping.dataTypes).toHaveLength(0);
  });

  it('code search agrees with registry claims: Vercel Analytics is Tauri-gated; no crash SDK ships', () => {
    // Vercel Analytics must stay gated behind !isTauri() to match web_analytics.
    // Additional web-only negated gates (e.g. marketing-capture suppression)
    // may chain after it, but the Tauri gate must come first.
    const mainTsx = readFileSync(join(__dirname, '..', '..', 'src', 'main.tsx'), 'utf8');
    expect(mainTsx).toContain('@vercel/analytics');
    expect(mainTsx).toMatch(/!isTauri\(\)\s*&&\s*(?:![\w$]+\s*&&\s*)*<Analytics\s*\/>/);

    // No crash-reporting SDK may appear in dependencies while
    // telemetry_crash_reporting claims zero egress.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const forbidden of ['sentry', 'crashlytics', 'bugsnag', 'posthog']) {
      expect(
        allDeps.some((d) => d.toLowerCase().includes(forbidden)),
        `crash/telemetry SDK "${forbidden}" found but registry claims no diagnostics ship`
      ).toBe(false);
    }
  });
});

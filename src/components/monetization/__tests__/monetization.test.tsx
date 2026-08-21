import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-scan invariant (openspec change implement-native-ios-storekit2-billing,
 * tasks §5.2): monetization components must never author literal
 * currency-formatted product prices. All displayed pricing comes from the
 * active billing provider's localized `priceFormatted` (StoreKit on iOS).
 *
 * The StoreKit sandbox fixture (`*.storekit`) is intentionally exempt — it is
 * test data consumed by Xcode, not app UI.
 */

const MONETIZATION_DIR = join(__dirname, '..');

// Matches currency-formatted price literals: $9.99, $12/month, €9,99,
// £79.99, ¥1200, 9.99 USD, CA$12.99 …
const CURRENCY_PRICE_PATTERN =
  /(?:[$€£¥]|USD|EUR|GBP|CAD|AUD)\s?\d+(?:[.,]\d{1,2})?(?:\s*\/\s*(?:month|mo|year|yr))?/i;

function monetizationSourceFiles(): string[] {
  return readdirSync(MONETIZATION_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => join(MONETIZATION_DIR, f));
}

describe('mock firewall: no literal prices in monetization components (§5.2)', () => {
  it('contains no currency-formatted price literals', () => {
    const violations: string[] = [];
    for (const file of monetizationSourceFiles()) {
      const source = readFileSync(file, 'utf-8');
      const lines = source.split('\n');
      lines.forEach((line, idx) => {
        // Strip comments so mentions like "$9.99 was the old mock price" in
        // docs still fail — but regex/string-escape artifacts don't false
        // positive on the scan regex itself.
        if (CURRENCY_PRICE_PATTERN.test(line)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('renders no price when products fail to load (retry state instead)', async () => {
    const { useBillingStore } = await import('../../../stores/billingStore');
    const { setActiveProviderForTesting } = await import('../../../stores/billingStore');
    const { MockBillingProvider } = await import('../../../lib/billing/types');
    const { render, screen } = await import('@testing-library/react');
    const { default: React } = await import('react');
    const { PaywallModal } = await import('../PaywallModal');
    const { usePaywallStore } = await import('../../../stores/paywallStore');

    setActiveProviderForTesting(new MockBillingProvider());
    // Simulate failed product load: empty products + settled error.
    useBillingStore.setState({ products: [], loading: false, error: 'PRODUCT_QUERY_FAILED' });
    usePaywallStore.setState({
      isOpen: true,
      activeContext: {
        title: 'Cloud Sync',
        description: 'Sync across devices.',
        capabilityId: 'cloud_sync',
        sourceSurface: 'test',
      } as never,
    });

    render(React.createElement(PaywallModal));

    expect(screen.getByTestId('paywall-product-error')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();

    setActiveProviderForTesting(null);
    usePaywallStore.setState({ isOpen: false, activeContext: null });
  });
});

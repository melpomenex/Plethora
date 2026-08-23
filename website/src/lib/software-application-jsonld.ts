import { COPY } from '../config/copy.ts';
import { CLAIMS, isPublicProductionClaim } from '../config/claims.ts';
import { DEFAULT_LAUNCH_FLAGS, type LaunchFlags } from '../config/launch.ts';
import { PLANS } from '../config/plans.ts';

export function publicOperatingSystems(): string[] {
  const desktop = CLAIMS.find((claim) => claim.id === 'desktop-win-mac-linux');
  if (!desktop || !isPublicProductionClaim(desktop) || !desktop.platforms) {
    return [];
  }
  const labels: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    ios: 'iOS',
    android: 'Android',
  };
  return desktop.platforms.map((id) => labels[id] ?? id);
}

export function softwareApplicationJsonLd(flags: LaunchFlags = DEFAULT_LAUNCH_FLAGS) {
  const pro = PLANS.find((plan) => plan.id === 'pro');
  const month = pro?.intervalPrices?.month;
  const os = publicOperatingSystems();

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: COPY.productName,
    applicationCategory: 'EducationalApplication',
    url: COPY.origin,
  };

  if (os.length > 0) {
    jsonLd.operatingSystem = os.join(', ');
  }

  if (month) {
    jsonLd.offers = {
      '@type': 'Offer',
      price: month.amount,
      priceCurrency: month.currency,
      availability: flags.checkoutEnabled
        ? 'https://schema.org/InStock'
        : 'https://schema.org/PreOrder',
    };
  }

  return jsonLd;
}

/**
 * Product identifiers shared across the frontend, the native Swift plugin
 * (`src-tauri/plugins/plethora-storekit/ios/Sources/StoreKitPlugin.swift`),
 * and the committed StoreKit configuration file
 * (`src-tauri/plugins/plethora-storekit/ios/Configuration/PlethoraProducts.storekit`).
 *
 * IDs ONLY — never prices. Localized pricing comes exclusively from StoreKit
 * (`Product.displayPrice`); see the mock-firewall invariant (tasks §5).
 */

export const PLETHORA_PRO_MONTHLY = 'plethora_pro_monthly';
export const PLETHORA_PRO_ANNUAL = 'plethora_pro_annual';

export const PLETHORA_PRODUCT_IDS: readonly [string, string] = [
  PLETHORA_PRO_MONTHLY,
  PLETHORA_PRO_ANNUAL,
];

export function isPlethoraProductId(id: string): boolean {
  return (PLETHORA_PRODUCT_IDS as readonly string[]).includes(id);
}

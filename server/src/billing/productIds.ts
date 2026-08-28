/** Google Play subscription product IDs accepted by the Plethora server. */
export const ALLOWED_PLAY_PRODUCT_IDS = [
  'plethora_pro_monthly',
  'plethora_pro_annual',
] as const;

export type AllowedPlayProductId = (typeof ALLOWED_PLAY_PRODUCT_IDS)[number];

export function isAllowedPlayProductId(productId: string): productId is AllowedPlayProductId {
  return (ALLOWED_PLAY_PRODUCT_IDS as readonly string[]).includes(productId);
}

export const MARKETING_CAPTURE_NAMESPACE_PREFIX = "plethora-marketing-capture-v2-";
const CAPTURE_NAMESPACE_RE = /^plethora-marketing-capture-v2-[0-9a-f]{16}$/;

export function marketingCaptureNamespace(fixtureHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(fixtureHash)) {
    throw new Error("Marketing capture fixture hash must be 64 lowercase hexadecimal characters");
  }
  return `${MARKETING_CAPTURE_NAMESPACE_PREFIX}${fixtureHash.slice(0, 16)}`;
}

export function isMarketingCaptureNamespace(value: unknown): value is string {
  return typeof value === "string" && CAPTURE_NAMESPACE_RE.test(value);
}

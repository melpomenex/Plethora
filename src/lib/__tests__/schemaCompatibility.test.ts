import { describe, expect, it } from "vitest";
import { preserveUnknownFields, supportsSyncDomain } from "../sync/schemaCompatibility";

describe("sync schema compatibility", () => {
  it("preserves additive fields for an older client", () => {
    const result = preserveUnknownFields(
      { schemaVersion: 2, domain: "cards", payload: { id: "1", future: 3 } },
      ["id"],
      1,
    );
    expect(result.payload.id).toBe("1");
    expect(result.payload["__unknown:future"]).toBe(3);
  });

  it("does not subscribe an unsupported domain", () => {
    expect(supportsSyncDomain("cards", ["cards"])).toBe(true);
    expect(supportsSyncDomain("newDomain", ["cards"])).toBe(false);
  });
});

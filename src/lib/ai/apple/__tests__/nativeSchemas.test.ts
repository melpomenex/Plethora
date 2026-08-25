import { describe, expect, it } from "vitest";
import { APPLE_FM_NATIVE_SCHEMAS, appleFmSupportsNativeSchema } from "../nativeSchemas";

describe("appleFmSupportsNativeSchema", () => {
  it("accepts compiled native schemas", () => {
    for (const name of APPLE_FM_NATIVE_SCHEMAS) {
      expect(appleFmSupportsNativeSchema(name)).toBe(true);
    }
  });

  it("rejects schemas that only exist on Android Nano or cloud strict JSON", () => {
    expect(appleFmSupportsNativeSchema("prerequisiteAnalysis")).toBe(false);
    expect(appleFmSupportsNativeSchema("answerAssessment")).toBe(false);
    expect(appleFmSupportsNativeSchema(undefined)).toBe(false);
  });
});

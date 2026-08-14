import { describe, it, expect } from "vitest";
import { resolveImportCategory } from "../importCategory";

describe("resolveImportCategory (fill-gaps semantics)", () => {
  it("preserves a category the import already assigned, ignoring the default", () => {
    // Source-specific imports (Web Import, Research Papers, ...) keep their
    // own category even when a default is configured.
    expect(resolveImportCategory("Web Import", "To-do")).toBe("Web Import");
  });

  it("falls back to the default when the document has no category", () => {
    // Generic file imports arrive without a category and get the default.
    expect(resolveImportCategory(undefined, "To-do")).toBe("To-do");
    expect(resolveImportCategory("", "Reading")).toBe("Reading");
    expect(resolveImportCategory(null, "Reading")).toBe("Reading");
  });

  it("treats a whitespace-only category as empty", () => {
    expect(resolveImportCategory("   ", "To-do")).toBe("To-do");
  });

  it("returns undefined when no default is configured ('None')", () => {
    expect(resolveImportCategory(undefined, "None")).toBeUndefined();
  });

  it("returns undefined when the store-default sentinel ('Uncategorized') is set", () => {
    expect(resolveImportCategory(undefined, "Uncategorized")).toBeUndefined();
  });

  it("preserves an existing category even when the default is a sentinel", () => {
    expect(resolveImportCategory("Research Papers", "None")).toBe("Research Papers");
  });
});

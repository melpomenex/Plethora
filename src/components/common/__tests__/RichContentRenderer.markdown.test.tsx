import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RichContentRenderer } from "../RichContentRenderer";

/**
 * Reading-surface markdown rendering (issue #44 bug 12): extracts without
 * stored html_content still carry annotation markup (**bold**, _italic_,
 * bullets) in their plain content; every full-mode reading surface renders
 * it through the sandboxed presentation instead of raw markup.
 */
describe("RichContentRenderer markdown fallback", () => {
  it("renders markup-bearing content in the sandboxed iframe when no htmlContent exists", () => {
    const { container } = render(
      <RichContentRenderer content="A **bold** statement" mode="full" />
    );
    const iframe = container.querySelector("iframe[title='Rich content']");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("keeps unformatted content in the accessible plain-text presentation", () => {
    const { container } = render(
      <RichContentRenderer content="FULL EXTRACT TEXT" mode="full" />
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("FULL EXTRACT TEXT");
  });

  it("falls back to plain text in text-only mode", () => {
    const { container } = render(
      <RichContentRenderer content="A **bold** statement" mode="text-only" />
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("A **bold** statement");
  });

  it("keeps using the stored html_content when present", () => {
    const { container } = render(
      <RichContentRenderer
        content="plain"
        htmlContent="<p><strong>stored</strong></p>"
        mode="full"
      />
    );
    const iframe = container.querySelector("iframe[title='Rich content']");
    expect(iframe).not.toBeNull();
  });
});

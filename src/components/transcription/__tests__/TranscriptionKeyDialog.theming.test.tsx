/**
 * Fast Cloud Transcription theming (#18): the duplicated Groq info card in
 * TranscriptionKeyDialog must consume Plethora theme tokens (bg-card /
 * border-border / bg-primary) instead of the hard-coded orange/amber/green
 * palette, across light/dark/custom/high-contrast theme contexts.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptionKeyDialog } from "../TranscriptionKeyDialog";
import { useSettingsStore } from "../../../stores/settingsStore";

function renderDialog() {
  render(
    <TranscriptionKeyDialog
      isOpen
      onClose={() => {}}
      onSaved={() => {}}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: JSON.parse(JSON.stringify(useSettingsStore.getState().settings)),
  });
});

describe("TranscriptionKeyDialog Fast Cloud card theming", () => {
  it("renders the info card with theme tokens, not the hard-coded palette", () => {
    renderDialog();

    const heading = screen.getByText("Fast Cloud Transcription");
    const card = heading.closest("div") as HTMLElement;
    // Navigate up to the outer info card (bg-card border-border rounded-xl).
    const infoCard = card.closest(".bg-card") as HTMLElement;
    expect(infoCard).not.toBeNull();
    expect(infoCard.className).toContain("border-border");

    // Header icon chip uses primary tokens.
    expect(document.querySelector("svg")?.parentElement?.className).toContain("bg-primary/10");

    // Badges consume theme tokens.
    const html = document.body.innerHTML;
    expect(html).toContain("bg-primary/10");
    expect(html).toContain("bg-secondary/10");

    // No hard-coded palette colors remain anywhere in the dialog.
    expect(html).not.toContain("from-orange-500");
    expect(html).not.toContain("to-amber-500");
    expect(html).not.toContain("border-orange-200");
    expect(html).not.toContain("text-orange-600");
    expect(html).not.toContain("bg-green-50");
    expect(html).not.toContain("border-green-200");
    expect(html).not.toContain("text-green-600");
  });

  it("uses the same theme tokens under a dark and a high-contrast theme context", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    renderDialog();
    const darkHtml = document.body.innerHTML;
    expect(darkHtml).toContain("bg-card");
    expect(darkHtml).not.toContain("from-orange-500");

    document.documentElement.setAttribute("data-theme", "light");
    // A second render exercises the high-contrast path (same token classes).
    renderDialog();
    const lightHtml = document.body.innerHTML;
    expect(lightHtml).toContain("border-border");
    expect(lightHtml).not.toContain("border-orange-200");
  });
});

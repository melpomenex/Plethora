import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantScopeSelector } from "../AssistantScopeSelector";
import type { AssistantScope } from "../../../lib/ai/assistant/scopes";
import { requestOverlayBack, resetOverlayStackForTests } from "../../../lib/overlayStack";
import { en } from "../../../lib/i18n/locales/en";
import { de } from "../../../lib/i18n/locales/de";
import { es } from "../../../lib/i18n/locales/es";
import { fr } from "../../../lib/i18n/locales/fr";
import { ja } from "../../../lib/i18n/locales/ja";
import { zh } from "../../../lib/i18n/locales/zh";

function SourceControl({ inline = false, initial = "chat" }: { inline?: boolean; initial?: AssistantScope }) {
  const [value, setValue] = useState<AssistantScope>(initial);
  return <AssistantScopeSelector value={value} onChange={setValue} variant={inline ? "inline" : "menu"} />;
}

beforeEach(() => resetOverlayStackForTests());

describe("Assistant source choices", () => {
  it.each([false, true])("maps localized choices to existing policies (inline: %s)", async (inline) => {
    const user = userEvent.setup();
    render(<SourceControl inline={inline} />);
    const trigger = screen.getByRole("button", { name: "Answer from: General knowledge" });
    expect(trigger).toHaveAccessibleDescription("Uses general knowledge and attached context.");
    await user.click(trigger);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByRole("menuitemradio", { name: /^General knowledge/ })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(trigger).toHaveAccessibleName("Answer from: This document only");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: /^My library/ }));
    expect(trigger).toHaveAccessibleName("Answer from: My library");
    expect(trigger).toHaveFocus();
  });

  it("keeps an inline menu in its parent and closes it before the host on Back", () => {
    const { container } = render(<SourceControl inline initial="library" />);
    const trigger = screen.getByRole("button", { name: "Answer from: My library" });
    fireEvent.click(trigger);
    expect(container).toContainElement(screen.getByRole("menu", { name: "Answer from" }));
    expect(screen.getByRole("menuitemradio", { name: /^My library/ })).toHaveFocus();
    act(() => { expect(requestOverlayBack()).toBe(true); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("dismisses with Escape and outside taps without selecting another source", () => {
    const onChange = vi.fn();
    render(<AssistantScopeSelector value="document" onChange={onChange} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables source changes while a turn is running", () => {
    const onChange = vi.fn();
    render(<AssistantScopeSelector value="document" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns Tab focus to the source trigger inside a mobile sheet", async () => {
    const user = userEvent.setup();
    render(<SourceControl inline />);
    const trigger = screen.getByRole("button");
    await user.click(trigger);
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it.each([de, es, fr, ja, zh])("provides all source copy in each supported translation", (dictionary) => {
    for (const key of Object.keys(en).filter((key) => key.startsWith("assistant.answerFrom."))) {
      expect(dictionary[key]).toBeTruthy();
      expect(dictionary[key]).not.toBe(en[key]);
    }
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageKnowledgeStateSelector } from "../LanguageKnowledgeStateSelector";

describe("LanguageKnowledgeStateSelector", () => {
  it("exposes all semantic states and separates memorization", () => {
    const onChange = vi.fn();
    render(<LanguageKnowledgeStateSelector value="encountered" onChange={onChange} />);
    expect(screen.getByRole("option", { name: "Known" })).toBeInTheDocument();
    expect(screen.getByText("Changing state does not create a review card.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "known" } });
    expect(onChange).toHaveBeenCalledWith("known");
  });
});

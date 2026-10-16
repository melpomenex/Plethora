import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const translate = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/languageTranslation", () => ({ createTranslationService: () => ({ translate }) }));
import { SelectionTranslationDialog } from "../SelectionTranslationDialog";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";

const selection = { text: "Bonjour. Comment allez-vous ?", documentId: "doc-1" };
describe("selection translation results", () => {
  beforeEach(() => {
    translate.mockReset();
    useLanguageProfileStore.setState({ activeProfile: null });
  });
  it("translates the entire selected passage and shows provenance without modifying its source", async () => {
    translate.mockResolvedValue({ translatedText: "Hello. How are you?", sourceLanguage: "fr", targetLanguage: "en", providerId: "local-model", provenance: { privacy: { description: "On this device" } } });
    render(<SelectionTranslationDialog selection={selection} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Source language"), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText("Translate into"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: /Translate selection/i }));
    expect(await screen.findByText("Hello. How are you?")).toBeVisible();
    expect(screen.getByText(selection.text)).toBeVisible();
    expect(screen.getByText(/local-model/)).toBeVisible();
    expect(translate).toHaveBeenCalledWith(expect.objectContaining({ text: selection.text, sourceLanguage: "fr", targetLanguage: "en", providerPolicy: { offline: false, privacy: "local-only" } }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("preserves text on error and permits explicit cloud fallback with retry", async () => {
    translate.mockRejectedValueOnce(new Error("Model unavailable"));
    render(<SelectionTranslationDialog selection={selection} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Translate into"), { target: { value: "de" } });
    fireEvent.click(screen.getByRole("button", { name: /Translate selection/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model unavailable");
    expect(screen.getByText(selection.text)).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox"));
    translate.mockResolvedValue({ translatedText: "Guten Tag", providerId: "configured-ai", sourceLanguage: "fr", targetLanguage: "de", provenance: { privacy: { description: "Cloud" } } });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Guten Tag")).toBeVisible();
    expect(translate.mock.lastCall?.[0].providerPolicy.privacy).toBe("allow-cloud");
  });
  it("aborts work on owner unmount and discards the late result", async () => {
    let resolve!: (value: unknown) => void;
    translate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<SelectionTranslationDialog selection={selection} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Translate into"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: /Translate selection/i }));
    await waitFor(() => expect(translate).toHaveBeenCalled());
    const signal = translate.mock.lastCall?.[1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ translatedText: "Late" }));
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
  });
});

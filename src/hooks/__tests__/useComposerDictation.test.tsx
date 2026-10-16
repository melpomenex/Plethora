import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerDictation, type ComposerDictation } from "../useComposerDictation";
const transport = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }));
vi.mock("../../lib/speech/dictation", async original => ({ ...await original<typeof import("../../lib/speech/dictation")>(), createDictationAdapter: () => transport }));
let control: ComposerDictation;
function Fixture({ active = true, resetKey = "session" }) {
  const [text, setText] = useState("hello world"); const inputRef = useRef<HTMLTextAreaElement>(null);
  control = useComposerDictation({ active, resetKey, text, setText, inputRef, requireOnDevice: false });
  return <textarea ref={inputRef} aria-label="Draft" value={text} onChange={event => { control.onEdit(); setText(event.target.value); }} />;
}
beforeEach(() => { vi.clearAllMocks(); transport.status.mockResolvedValue({ platform: "android", available: true, locale: "en-US", processing: "on-device", microphonePermission: "granted" }); transport.start.mockResolvedValue(undefined); transport.stop.mockResolvedValue({ text: "dictated" }); transport.cancel.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });
describe("shared composer dictation", () => {
  it("checks capability without starting capture on open", async () => { render(<Fixture />); await waitFor(() => expect(transport.status).toHaveBeenCalled()); expect(transport.start).not.toHaveBeenCalled(); expect(screen.getByRole("textbox")).toHaveValue("hello world"); });
  it("inserts final text once at the saved selection without sending", async () => {
    render(<Fixture />); await waitFor(() => expect(control.capability).not.toBeNull()); (screen.getByRole("textbox") as HTMLTextAreaElement).setSelectionRange(6, 11);
    await act(async () => { await control.start(); }); await act(async () => { await Promise.all([control.stop(), control.stop()]); });
    expect(screen.getByRole("textbox")).toHaveValue("hello dictated"); expect(transport.stop).toHaveBeenCalledOnce();
  });
  it("user edit cancels capture and rejects a late final result", async () => {
    let final!: (value: { text: string }) => void; transport.stop.mockReturnValue(new Promise(resolve => { final = resolve; }));
    render(<Fixture />); await waitFor(() => expect(control.capability).not.toBeNull()); await act(async () => { await control.start(); });
    let pending!: Promise<void>; act(() => { pending = control.stop(); }); fireEvent.change(screen.getByRole("textbox"), { target: { value: "explicit edit" } });
    await act(async () => { final({ text: "late" }); await pending; }); expect(screen.getByRole("textbox")).toHaveValue("explicit edit"); expect(transport.cancel).toHaveBeenCalled();
  });
  it("close and view/reset changes cancel without touching the draft", async () => {
    const view = render(<Fixture />); await waitFor(() => expect(control.capability).not.toBeNull()); await act(async () => { await control.start(); });
    view.rerender(<Fixture resetKey="next-view" />); await waitFor(() => expect(transport.cancel).toHaveBeenCalled()); expect(screen.getByRole("textbox")).toHaveValue("hello world");
    await act(async () => { await control.start(); }); view.rerender(<Fixture active={false} resetKey="next-view" />); expect(screen.getByRole("textbox")).toHaveValue("hello world");
  });
  it("requires explicit network consent before any system capture", async () => {
    transport.status.mockResolvedValue({ platform: "web", available: true, locale: "en-US", processing: "unknown", microphonePermission: "unknown" }); render(<Fixture />); await waitFor(() => expect(control.capability).not.toBeNull());
    await act(async () => { await control.start(); }); expect(control.needsConsent).toBe(true); expect(transport.start).not.toHaveBeenCalled();
    await act(async () => { await control.start(true); }); expect(transport.start).toHaveBeenCalledOnce();
  });
});

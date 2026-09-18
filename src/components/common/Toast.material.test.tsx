import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Toast, ToastType, useToastStore } from "./Toast";

afterEach(() => { cleanup(); useToastStore.getState().clearAll(); vi.useRealTimers(); });
describe("snackbar dismissal", () => {
  it("pauses the actual deadline while hovered and resumes the remaining time", () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast({type: ToastType.Info, title: "Saved", duration: 5000});
    render(<Toast />);
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).toBeNull();
  });
  it("keeps zero-duration notifications indefinitely", () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast({type: ToastType.Info, title: "Persistent", duration: 0});
    render(<Toast />);
    fireEvent.mouseEnter(screen.getByRole("status"));
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(100000));
    expect(screen.getByText("Persistent")).toBeInTheDocument();
  });
});

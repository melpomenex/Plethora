import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GracefulAiFallbackCard, classifyAiError } from "../GracefulAiFallbackCard";

describe("GracefulAiFallbackCard", () => {
  it("renders Request Timeout badge, preserves quote & prompt, and retries with 0.5 context scale", () => {
    const onFallbackManual = vi.fn();
    const onRetrySmallerContext = vi.fn();

    render(
      <GracefulAiFallbackCard
        errorKind="timeout"
        preservedQuote="CAP theorem proof"
        preservedPrompt="Compare CP vs AP"
        onFallbackManual={onFallbackManual}
        onRetrySmallerContext={onRetrySmallerContext}
      />
    );

    expect(screen.getByText("Request Timeout")).toBeInTheDocument();
    expect(screen.getByText(/CAP theorem proof/)).toBeInTheDocument();
    expect(screen.getByText(/Compare CP vs AP/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry with Smaller Context/i }));
    expect(onRetrySmallerContext).toHaveBeenCalledWith(0.5);
  });

  it("renders Local LLM Offline badge and triggers manual extract fallback", () => {
    const onFallbackManual = vi.fn();

    render(
      <GracefulAiFallbackCard
        errorKind="offline"
        preservedQuote="Distributed consensus"
        onFallbackManual={onFallbackManual}
        onRetrySmallerContext={vi.fn()}
      />
    );

    expect(screen.getByText("Local LLM Offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Fallback to Manual Extract/i }));
    expect(onFallbackManual).toHaveBeenCalledTimes(1);
  });

  it("classifies timeout vs offline errors accurately", () => {
    expect(classifyAiError(new Error("Request timed out after 30s"))).toBe("timeout");
    expect(classifyAiError(new Error("ECONNREFUSED 127.0.0.1:11434"))).toBe("offline");
  });
});

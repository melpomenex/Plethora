import { describe, expect, it } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../test/utils";
import { ReviewComplete } from "../ReviewComplete";

function renderComplete() {
  return renderWithProviders(
    <ReviewComplete
      reviewsCompleted={3}
      correctCount={2}
      sessionStartTime={Date.now() - 30_000}
    />,
  );
}

describe("ReviewComplete navigation", () => {
  it("sends the tab shell to the queue via the navigate event", () => {
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener("navigate", listener);
    try {
      renderComplete();
      fireEvent.click(screen.getByRole("button", { name: "Back to Queue" }));
    } finally {
      window.removeEventListener("navigate", listener);
    }

    expect(details).toEqual(["/queue"]);
  });

  it("sends the tab shell to the dashboard via the navigate event", () => {
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener("navigate", listener);
    try {
      renderComplete();
      fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));
    } finally {
      window.removeEventListener("navigate", listener);
    }

    expect(details).toEqual(["/dashboard"]);
  });
});

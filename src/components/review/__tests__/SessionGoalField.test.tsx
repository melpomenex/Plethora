import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  DEFAULT_CUSTOMIZATION,
  SessionCustomizeModal,
  type SessionCustomization,
} from "../SessionCustomizeModal";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";
import { MAX_SESSION_GOAL_LENGTH } from "../../../lib/daqe/sessionGoal";

/**
 * The Session Goal field, tested against the modal directly rather than through
 * `ReviewQueueView`, because the behaviour under test is the field's own: what it
 * commits, what it refuses, and which controls it inherits.
 */

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings;
}

function open(overrides: Partial<SessionCustomization> = {}, props = {}) {
  const customization: SessionCustomization = { ...DEFAULT_CUSTOMIZATION, ...overrides };
  const onChange = vi.fn();
  const onScheduleRerank = vi.fn();
  const view = render(
    <SessionCustomizeModal
      isOpen
      onClose={() => {}}
      customization={customization}
      onChange={onChange}
      onApply={() => {}}
      onScheduleRerank={onScheduleRerank}
      {...props}
    />,
  );
  const field = () => screen.queryByLabelText("Session Goal") as HTMLInputElement | null;
  return { view, field, onChange, onScheduleRerank };
}

function enableRanking() {
  useSettingsStore.getState().updateSettingsCategory("daqe", { rankingEnabled: true });
}

describe("Session Goal field", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("renders inside the Adaptive Ranking section when ranking is on", () => {
    enableRanking();
    const { field } = open();
    expect(field()).not.toBeNull();
    expect(field()!.placeholder).toContain("Exam Review");
  });

  it("inherits the ranking gate and is absent when ranking is off", () => {
    // The field only means something when the goal-relevance term is live.
    expect(open().field()).toBeNull();
  });

  it("is absent when the caller does not show the DAQE panel at all", () => {
    enableRanking();
    expect(open({}, { showDaque: false }).field()).toBeNull();
  });

  it("shows the persisted goal rather than an empty field", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      sessionGoal: "Linear Algebra",
    });
    expect(open().field()!.value).toBe("Linear Algebra");
  });

  it("commits a typed goal and re-ranks", () => {
    enableRanking();
    const { field, onScheduleRerank } = open();
    fireEvent.change(field()!, { target: { value: "Reducibility Proofs" } });
    fireEvent.blur(field()!);

    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("Reducibility Proofs");
    expect(onScheduleRerank).toHaveBeenCalled();
  });

  it("trims a goal rather than storing its padding", () => {
    enableRanking();
    const { field } = open();
    fireEvent.change(field()!, { target: { value: "  Exam Review  " } });
    fireEvent.blur(field()!);
    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("Exam Review");
  });

  it("treats a whitespace-only goal as no goal", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", { sessionGoal: "Exam Review" });
    const { field } = open();
    fireEvent.change(field()!, { target: { value: "   " } });
    fireEvent.blur(field()!);
    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("");
  });

  it("refuses an over-long goal, keeps the previous one, and says why", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", { sessionGoal: "Exam Review" });
    const { field } = open();

    fireEvent.change(field()!, {
      target: { value: "x".repeat(MAX_SESSION_GOAL_LENGTH + 1) },
    });
    fireEvent.blur(field()!);

    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("Exam Review");
    expect(screen.getByText(new RegExp(String(MAX_SESSION_GOAL_LENGTH)))).toBeInTheDocument();
    expect(field()!.getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the refusal once the goal is valid again", () => {
    enableRanking();
    const { field } = open();
    fireEvent.change(field()!, {
      target: { value: "x".repeat(MAX_SESSION_GOAL_LENGTH + 1) },
    });
    fireEvent.blur(field()!);
    fireEvent.change(field()!, { target: { value: "Exam Review" } });

    expect(field()!.getAttribute("aria-invalid")).toBeNull();
  });

  it("records a committed goal in the recent history", () => {
    enableRanking();
    const { field } = open();
    fireEvent.change(field()!, { target: { value: "Topology" } });
    fireEvent.blur(field()!);
    expect(useSettingsStore.getState().settings.daqe.recentGoals).toEqual(["Topology"]);
  });

  it("renders no chips when nothing has been used", () => {
    enableRanking();
    open();
    expect(screen.queryByRole("button", { name: "Topology" })).toBeNull();
  });

  it("sets the field from a recent-goal chip", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      recentGoals: ["Linear Algebra", "Topology"],
      sessionGoal: "",
    });
    const { onScheduleRerank } = open();
    fireEvent.click(screen.getByRole("button", { name: "Topology" }));

    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("Topology");
    expect(onScheduleRerank).toHaveBeenCalled();
  });

  it("does not duplicate a chip goal in the history", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      recentGoals: ["Linear Algebra", "Topology"],
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Topology" }));
    expect(useSettingsStore.getState().settings.daqe.recentGoals).toEqual([
      "Topology",
      "Linear Algebra",
    ]);
  });

  it("labels the field for assistive technology and points at its help text", () => {
    enableRanking();
    const { field } = open();
    expect(field()!.id).toBe("daqe-session-goal");
    expect(field()!.getAttribute("aria-describedby")).toBe("daqe-session-goal-desc");
    expect(screen.getByText(/Decision models use it/i)).toBeInTheDocument();
  });

  it("uses only defined design tokens", () => {
    // `--color-accent` is never declared in the theme, so any accent-* utility on
    // this field would resolve to nothing.
    enableRanking();
    const { field } = open();
    expect(field()!.className).toContain("border-border");
    expect(field()!.className).toContain("bg-background");
    expect(field()!.className).not.toContain("accent-");
  });

  it("lives inside the dialog's existing scroll container, adding no new one", () => {
    // The field must not push the lower ranking sliders out of reach. It adds no
    // fixed height and no nested scroller: it is one more block in the region that
    // already scrolls, alongside the sticky header and footer.
    enableRanking();
    const { field } = open();

    const panel = field()!.closest(".fixed")!.querySelector(".overflow-auto")!;
    expect(panel).not.toBeNull();
    expect(panel.contains(field()!)).toBe(true);

    // The knob panel below it is in the same scroll region, so both are reachable.
    const knobPanel = within(panel as HTMLElement).getByRole("slider", {
      name: /goal relevance/i,
    });
    expect(panel.contains(knobPanel)).toBe(true);
    expect(
      field()!.compareDocumentPosition(knobPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Reset to Defaults and the session goal", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("clears the goal and resets the session draft together", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", { sessionGoal: "Exam Review" });
    const { onChange, onScheduleRerank } = open({ maxItems: 12 });

    fireEvent.click(screen.getByText("Reset to Defaults"));

    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("");
    expect(onChange).toHaveBeenCalledWith(DEFAULT_CUSTOMIZATION);
    expect(onScheduleRerank).toHaveBeenCalled();
  });

  it("keeps the recent-goals history, which is not part of this session", () => {
    enableRanking();
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      sessionGoal: "Exam Review",
      recentGoals: ["Exam Review", "Linear Algebra"],
    });
    open();

    fireEvent.click(screen.getByText("Reset to Defaults"));

    expect(useSettingsStore.getState().settings.daqe.recentGoals).toEqual([
      "Exam Review",
      "Linear Algebra",
    ]);
  });

  it("never mutates the shared DEFAULT_CUSTOMIZATION object", () => {
    enableRanking();
    const snapshot = JSON.stringify(DEFAULT_CUSTOMIZATION);
    const { onChange } = open({ maxItems: 99 });
    fireEvent.click(screen.getByText("Reset to Defaults"));

    expect(JSON.stringify(DEFAULT_CUSTOMIZATION)).toBe(snapshot);
    // The reset must hand over the constant by reference without having edited it.
    expect(onChange).toHaveBeenCalledWith(DEFAULT_CUSTOMIZATION);
  });
});
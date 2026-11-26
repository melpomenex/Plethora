/**
 * Unit tests for the Study Plan ↔ language profile linkage wrapper
 * (`updateStudyPlanLanguageLinkage`): command args, null-coalescing, and
 * error normalization.
 */

import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: () => true,
  isNativeMobile: () => false,
}));

import { updateStudyPlanLanguageLinkage } from "../study-plans";

describe("updateStudyPlanLanguageLinkage", () => {
  it("sends planId plus the three nullable linkage fields to the Rust command", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);
    await updateStudyPlanLanguageLinkage("sp_1", "lp_9", "B1", {
      freeText: "travel phrases",
    });

    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "update_study_plan_language_linkage",
      {
        planId: "sp_1",
        languageProfileId: "lp_9",
        targetProficiency: "B1",
        languageFocus: { freeText: "travel phrases" },
      },
    );
  });

  it("coalesces null linkage fields instead of sending undefined", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);
    await updateStudyPlanLanguageLinkage("sp_2", null, null, null);

    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "update_study_plan_language_linkage",
      {
        planId: "sp_2",
        languageProfileId: null,
        targetProficiency: null,
        languageFocus: null,
      },
    );
  });

  it("normalizes a Tauri failure into a StudyApiError", async () => {
    mocks.invokeCommand.mockRejectedValueOnce(
      new Error("IPC channel closed"),
    );

    await expect(
      updateStudyPlanLanguageLinkage("sp_3", null, null, null),
    ).rejects.toMatchObject({ name: "StudyApiError", retryable: true });
  });
});

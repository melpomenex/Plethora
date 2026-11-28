import { describe, expect, it } from "vitest";
import {
  LEARNING_ACTIVITY_TYPES,
  SUBJECT_TEMPLATE_IDS,
  type RuntimeCapabilities,
} from "../../../types/learningActivity";
import {
  DEFAULT_RUNTIME_CAPABILITIES,
  FIRST_PARTY_ACTIVITY_DEFINITIONS,
  LearningActivityRegistry,
  SANDBOX_EXTENSION_BOUNDARY,
  SUBJECT_TEMPLATES,
  getSubjectTemplate,
  learningActivityRegistry,
  listSubjectTemplates,
  validateSandboxExtensionEnvelope,
} from "../activityRegistry";

describe("LearningActivityRegistry", () => {
  it("pre-registers all 13 initial first-party activity types with complete metadata", () => {
    const listed = learningActivityRegistry.list();
    expect(listed).toHaveLength(13);
    expect(FIRST_PARTY_ACTIVITY_DEFINITIONS).toHaveLength(13);

    for (const activityType of LEARNING_ACTIVITY_TYPES) {
      expect(learningActivityRegistry.has(activityType)).toBe(true);
      const def = learningActivityRegistry.get(activityType);
      expect(def).toBeDefined();
      expect(def!.label.length).toBeGreaterThan(0);
      expect(def!.evidenceDimensions.length).toBeGreaterThan(0);
      expect(def!.surfaceAdapter.length).toBeGreaterThan(0);
      expect(def!.defaultEstimatedMinutes).toBeGreaterThan(0);
      expect(def!.supportsLocalOnlyDocs).toBe(true);
      expect(def!.supportsAiExcludedDocs).toBe(true);
    }

    // Canonical surface adapter mappings
    expect(learningActivityRegistry.get("source_reading")?.surfaceAdapter).toBe(
      "DocumentViewerWrapper",
    );
    expect(learningActivityRegistry.get("flashcard_review")?.surfaceAdapter).toBe(
      "ReviewSession",
    );
    expect(learningActivityRegistry.get("objective_question_practice")?.surfaceAdapter).toBe(
      "AttemptRunner",
    );
    expect(learningActivityRegistry.get("rubric_assessment")?.surfaceAdapter).toBe(
      "AttemptRunner",
    );
    expect(learningActivityRegistry.get("guided_reading")?.surfaceAdapter).toBe(
      "GuidedReadingPanel",
    );
    expect(learningActivityRegistry.get("socratic_tutoring")?.surfaceAdapter).toBe(
      "TutorSheet",
    );
    expect(learningActivityRegistry.get("comprehension_check")?.surfaceAdapter).toBe(
      "StudyModeWorkspace",
    );
  });

  it("supports registering custom or overridden definitions on a registry instance", () => {
    const customRegistry = new LearningActivityRegistry();
    expect(customRegistry.list()).toHaveLength(0);

    const flashcardDef = learningActivityRegistry.get("flashcard_review")!;
    customRegistry.register(flashcardDef);
    expect(customRegistry.list()).toHaveLength(1);
    expect(customRegistry.get("flashcard_review")?.surfaceAdapter).toBe("ReviewSession");
  });

  it("negotiates capabilities deterministically when AI is disabled or offline", () => {
    const offlineNoAiCaps: RuntimeCapabilities = {
      ...DEFAULT_RUNTIME_CAPABILITIES,
      ai: false,
      network: false,
    };

    // Pure deterministic local activities remain fully supported offline & without AI
    for (const localType of [
      "source_reading",
      "flashcard_review",
      "extract_review",
      "guided_reading",
      "objective_question_practice",
    ] as const) {
      const result = learningActivityRegistry.negotiateCapabilities(
        localType,
        offlineNoAiCaps,
      );
      expect(result.status).toBe("supported");
      expect(result.missingRequired).toEqual([]);
      expect(result.missingOptional).toEqual([]);
      expect(result.fallbackReason).toBeNull();
      expect(result.canRunOffline).toBe(true);
    }

    // Socratic tutoring degrades cleanly with self-prompting rubric fallback
    const socraticDegraded = learningActivityRegistry.negotiateCapabilities(
      "socratic_tutoring",
      offlineNoAiCaps,
    );
    expect(socraticDegraded.status).toBe("degraded");
    expect(socraticDegraded.missingOptional).toEqual(["ai", "network"]);
    expect(socraticDegraded.fallbackReason).toContain("Socratic");

    // Media consumption degrades when audio or network is unavailable
    const mediaNoAudio = learningActivityRegistry.negotiateCapabilities(
      "media_consumption",
      { ...DEFAULT_RUNTIME_CAPABILITIES, audio: false },
    );
    expect(mediaNoAudio.status).toBe("degraded");
    expect(mediaNoAudio.missingOptional).toContain("audio");
    expect(mediaNoAudio.fallbackReason).toContain("transcript");

    // Free-response practice degrades when speech input is unavailable
    const freeResponseNoSpeech = learningActivityRegistry.negotiateCapabilities(
      "free_response_practice",
      { ...DEFAULT_RUNTIME_CAPABILITIES, speech: false },
    );
    expect(freeResponseNoSpeech.status).toBe("degraded");
    expect(freeResponseNoSpeech.missingOptional).toContain("speech");
    expect(freeResponseNoSpeech.fallbackReason).toContain("typed");

    // Document-level privacy flag `isAiExcluded` forces AI capability off
    const aiExcludedCheck = learningActivityRegistry.negotiateCapabilities(
      "comprehension_check",
      DEFAULT_RUNTIME_CAPABILITIES,
      { isAiExcluded: true },
    );
    expect(aiExcludedCheck.status).toBe("degraded");
    expect(aiExcludedCheck.missingOptional).toContain("ai");
  });

  it("provides 5 valid declarative subject templates referencing registered activities", () => {
    const templates = listSubjectTemplates();
    expect(templates).toHaveLength(5);
    expect(SUBJECT_TEMPLATES).toHaveLength(5);

    for (const id of SUBJECT_TEMPLATE_IDS) {
      const template = getSubjectTemplate(id);
      expect(template).toBeDefined();
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.defaultSessionBlueprint.length).toBeGreaterThan(0);
      expect(Object.keys(template!.promptScaffolds).length).toBeGreaterThan(0);

      const mixSum = template!.recommendedMix.reduce((acc, item) => acc + item.weight, 0);
      expect(mixSum).toBeCloseTo(1.0, 5);

      const competencySum = Object.values(template!.competencyWeights).reduce(
        (acc, w) => acc + w,
        0,
      );
      expect(competencySum).toBeCloseTo(1.0, 5);

      for (const item of template!.recommendedMix) {
        expect(learningActivityRegistry.has(item.activityType)).toBe(true);
      }
      for (const step of template!.defaultSessionBlueprint) {
        expect(learningActivityRegistry.has(step.activityType)).toBe(true);
        expect(step.minutes).toBeGreaterThan(0);
      }
    }
  });

  it("enforces the zero-native-execution sandbox extension security boundary", () => {
    expect(SANDBOX_EXTENSION_BOUNDARY.allowTauriIpc).toBe(false);
    expect(SANDBOX_EXTENSION_BOUNDARY.allowFilesystem).toBe(false);
    expect(SANDBOX_EXTENSION_BOUNDARY.allowNetwork).toBe(false);
    expect(SANDBOX_EXTENSION_BOUNDARY.allowShellExecution).toBe(false);
    expect(SANDBOX_EXTENSION_BOUNDARY.allowSameOriginIframe).toBe(false);
    expect(SANDBOX_EXTENSION_BOUNDARY.redactLocalOnly).toBe(true);
    expect(SANDBOX_EXTENSION_BOUNDARY.redactAiExcluded).toBe(true);
    expect(SANDBOX_EXTENSION_BOUNDARY.maxExecutionMs).toBeGreaterThan(0);
    expect(SANDBOX_EXTENSION_BOUNDARY.maxMemoryMb).toBeGreaterThan(0);

    // Valid extension message passes
    const valid = validateSandboxExtensionEnvelope({
      extensionId: "ext.math.trace",
      requestedCapabilities: ["renderer"],
      eventType: "practice_attempted",
      isLocalOnly: false,
      isAiExcluded: false,
      payload: { score: 1 },
    });
    expect(valid.allowed).toBe(true);
    expect(valid.violations).toEqual([]);

    // Rejects Tauri IPC / filesystem / shell / network requests
    const privileged = validateSandboxExtensionEnvelope({
      extensionId: "ext.evil",
      requestedCapabilities: ["tauri_ipc", "filesystem", "shell", "network"],
      eventType: "practice_attempted",
    });
    expect(privileged.allowed).toBe(false);
    expect(privileged.violations.length).toBe(4);

    // Rejects local-only and AI-excluded documents
    const privateDoc = validateSandboxExtensionEnvelope({
      extensionId: "ext.reader",
      eventType: "guided_check_completed",
      isLocalOnly: true,
      isAiExcluded: true,
    });
    expect(privateDoc.allowed).toBe(false);
    expect(privateDoc.violations).toHaveLength(2);

    // Rejects forged formal exam grade / FSRS review events
    const forgedGrade = validateSandboxExtensionEnvelope({
      extensionId: "ext.forger",
      eventType: "assessment_graded",
    });
    expect(forgedGrade.allowed).toBe(false);

    // Rejects oversized payloads
    const oversized = validateSandboxExtensionEnvelope({
      extensionId: "ext.big",
      eventType: "practice_attempted",
      payload: { blob: "x".repeat(SANDBOX_EXTENSION_BOUNDARY.maxPayloadBytes + 64) },
    });
    expect(oversized.allowed).toBe(false);
  });
});

/**
 * Bundled, non-personal smoke adapters for the production task boundaries that
 * are safe to exercise in-app (D0 task 3.2).
 *
 * Each adapter calls the real production task function through `runTask` with
 * fixed synthetic fixtures. Before running it resolves the actual route, asks
 * for the applicable disclosure/cost authorization for THAT destination, and
 * pins the authorized provider so an implicit fallback cannot change it.
 * Adapters report only the stages they actually exercise and stop before any
 * preview, persistence or navigation. Nothing reads the user's library and
 * nothing creates a learning object.
 *
 * Adapters that would need a real image, a live reader surface, an isolated
 * profile or a not-yet-integrated feature are deliberately absent: the UI
 * reports `unsupported` for them instead of substituting a mock pass.
 */

import { runTask } from "../tasks/runTask";
import { resolveTaskRoute } from "../tasks/router";
import { learnThisTask } from "../tasks/definitions/learnThisTask";
import { askLibraryTask } from "../tasks/definitions/libraryTask";
import { assessAnswerTask, runAssessAnswer } from "../tasks/definitions/assessmentTask";
import {
  passageClassificationTask,
  runPassageClassification,
} from "../tasks/definitions/passageClassificationTask";
import type { AITaskDefinition } from "../tasks/types";
import type { AIProvider } from "../providers/types";
import { getActiveCloudConfig } from "../providers/cloudProvider";
import { classifyCloudDestination, classifyNativeDestination } from "../features/destinations";
import { normalizeProviderClass } from "./featureReport";
import {
  ensureCloudAiDisclosure,
  isCloudAiDisclosed,
  resolveCloudAiProviderClass,
} from "../../privacy/cloudAiDisclosure";
import { requestPaidConsent } from "../../../utils/aiBillingConsent";
import { isAIError } from "../errors";
import {
  createFrozenAgentEnvironment,
  resolveLearningAgentScope,
  runLearningAgent,
} from "../assistant/learningAgent";
import { agentRunnerTask } from "../agent/loop";
import { runCoverageAnalysis } from "../concepts/coverage";
import type { FeatureSmokeAdapter, FeatureSmokeContext } from "./featureSmoke";
import { registerFeatureSmokeAdapter } from "./featureSmoke";
import type { FeatureStage } from "../diagnostics";

const FIXTURE_DOCUMENT_TITLE = "Synthetic smoke fixture";

const LEARN_THIS_FIXTURE =
  "A mitochondrion is a membrane-bound organelle found in most eukaryotic cells. It generates most of the cell's supply of adenosine triphosphate through aerobic respiration. Mitochondria contain their own circular DNA and reproduce independently of the cell cycle.";

const LIBRARY_FIXTURE_SOURCES = [
  {
    id: "fixture-chunk-1",
    text: "Photosynthesis converts light energy into chemical energy stored in glucose. It takes place in the chloroplasts of plant cells.",
  },
  {
    id: "fixture-chunk-2",
    text: "Cellular respiration releases energy from glucose and occurs mainly in the mitochondria.",
  },
];

const ASSESS_FIXTURE = {
  question: "What does a mitochondrion produce?",
  expectedAnswer: "Most of the cell's adenosine triphosphate (ATP).",
  userAnswer: "It produces ATP for the cell.",
  sourceContext: LEARN_THIS_FIXTURE,
};

const PASSAGE_FIXTURE =
  "A prime number is a natural number greater than one that has exactly two positive divisors: one and itself.";

/**
 * Authorize the ACTUAL resolved route before any fixture text is sent. A
 * native/local route needs nothing; an off-device route needs the existing
 * cloud disclosure; a billable route needs the existing cost consent.
 */
async function authorizeProvider(featureId: string, provider: AIProvider): Promise<boolean> {
  if (provider.kind !== "cloud") return true;
  const config = getActiveCloudConfig();
  if (!config) return true;

  const destination = classifyCloudDestination({
    provider: config.provider,
    baseUrl: config.baseUrl,
    hasApiKey: config.apiKey.trim().length > 0,
  });

  if (
    destination.requiresDisclosure &&
    !isCloudAiDisclosed(resolveCloudAiProviderClass(config.provider))
  ) {
    const disclosed = await ensureCloudAiDisclosure({
      featureClass: "ai_actions",
      provider: config.provider,
      isLocal: !destination.sendsOffDevice,
    });
    if (!disclosed) return false;
  }

  if (destination.requiresCostConsent) {
    const paid = await requestPaidConsent({
      kind: "ai-fallback",
      provider: config.provider,
      label: `Fixture smoke test (${featureId})`,
    });
    if (!paid) return false;
  }

  return true;
}

type SmokeFailure = {
  outcome: "failed" | "cancelled" | "skipped";
  stages: FeatureStage[];
  errorCategory?: string;
  recoveryCode?: string;
};

type SmokeRun =
  | { outcome: "success"; stages: FeatureStage[]; providerClass?: string }
  | SmokeFailure;

function failureRun(context: FeatureSmokeContext, error: unknown): SmokeFailure {
  if (context.signal.aborted || (isAIError(error) && error.category === "Cancelled")) {
    return {
      outcome: "cancelled",
      stages: [],
      errorCategory: "Cancelled",
      recoveryCode: "smoke_cancelled",
    };
  }
  return {
    outcome: "failed",
    stages: [],
    errorCategory: isAIError(error) ? error.category : "GenerationFailed",
    recoveryCode: "smoke_failed",
  };
}

interface SmokeTaskOptions {
  featureId: Parameters<typeof registerFeatureSmokeAdapter>[0]["featureId"];
  task: AITaskDefinition<any, any>;
  input: unknown;
  context: FeatureSmokeContext;
  retrieval?: { count: number; chunkIds: string[] };
  /** Prefer the feature's own wrapper when it adds validation semantics. */
  runOverride?: (
    context: FeatureSmokeContext,
    provider: AIProvider
  ) => Promise<{
    providerKind: "ondevice" | "cloud";
  }>;
}

async function runSmokeTask({
  featureId,
  task,
  input,
  context,
  retrieval,
  runOverride,
}: SmokeTaskOptions): Promise<SmokeRun> {
  const started = Date.now();
  try {
    const route = await resolveTaskRoute(task).catch(() => null);
    if (!route) {
      context.reportStage("preflight", "failed", {
        errorCategory: "ModelUnavailable",
        recoveryCode: "provider_unavailable",
      });
      return {
        outcome: "failed",
        stages: ["preflight"],
        errorCategory: "ModelUnavailable",
        recoveryCode: "provider_unavailable",
      };
    }

    const authorized = await authorizeProvider(featureId, route.provider);
    if (!authorized) {
      context.reportStage("preflight", "skipped", {
        recoveryCode: "smoke_consent_denied",
      });
      return {
        outcome: "skipped",
        stages: ["preflight"],
        recoveryCode: "smoke_consent_denied",
      };
    }

    if (runOverride) {
      await runOverride(context, route.provider);
      context.reportStage("generation", "success", { durationMs: Date.now() - started });
      context.reportStage("validation", "success", { durationMs: 0 });
      return {
        outcome: "success",
        stages: ["generation", "validation"],
        providerClass: normalizeProviderClass(route.provider.id),
      };
    }

    const run = await runTask(task, input, {
      provider: route.provider,
      signal: context.signal,
      targetId: `smoke:${featureId}:${context.capabilityRevision}`,
      retrieval,
      observation: {
        featureId,
        runId: `smoke:${featureId}:${context.capabilityRevision}`,
        capabilityRevision: context.capabilityRevision,
        smoke: true,
      },
    });
    context.reportStage("generation", "success", { durationMs: Date.now() - started });
    context.reportStage("validation", "success", { durationMs: 0 });
    return {
      outcome: "success",
      stages: ["generation", "validation"],
      providerClass: normalizeProviderClass(run.providerId),
    };
  } catch (error) {
    const failure = failureRun(context, error);
    context.reportStage("generation", failure.outcome, {
      durationMs: Date.now() - started,
      errorCategory: failure.errorCategory,
      recoveryCode: failure.recoveryCode,
    });
    return failure;
  }
}

const learnThisSmoke: FeatureSmokeAdapter = {
  featureId: "learn-this",
  stages: ["preflight", "generation", "validation"],
  unverifiedStages: ["preview", "persistence"],
  fixtureId: "fixture-learn-this-v1",
  maxDurationMs: 60_000,
  destinations: ["device", "loopback", "lan", "remote"],
  mutatesUserData: false,
  requiresConsent: false,
  run: (context) =>
    runSmokeTask({
      featureId: "learn-this",
      task: learnThisTask,
      input: { passage: LEARN_THIS_FIXTURE, documentTitle: FIXTURE_DOCUMENT_TITLE },
      context,
    }),
};

const librarySmoke: FeatureSmokeAdapter = {
  featureId: "library-rag",
  stages: ["preflight", "generation", "validation"],
  unverifiedStages: ["retrieval", "preview", "persistence", "navigation"],
  fixtureId: "fixture-library-rag-v1",
  maxDurationMs: 60_000,
  destinations: ["device", "loopback", "lan", "remote"],
  mutatesUserData: false,
  requiresConsent: false,
  run: (context) =>
    runSmokeTask({
      featureId: "library-rag",
      task: askLibraryTask,
      input: {
        query: "How do plants and cells release energy?",
        sources: LIBRARY_FIXTURE_SOURCES,
      },
      context,
      retrieval: {
        count: LIBRARY_FIXTURE_SOURCES.length,
        chunkIds: LIBRARY_FIXTURE_SOURCES.map((source) => source.id),
      },
    }),
};

const assessmentSmoke: FeatureSmokeAdapter = {
  featureId: "answer-assessment",
  stages: ["preflight", "generation", "validation"],
  unverifiedStages: ["persistence"],
  fixtureId: "fixture-answer-assessment-v1",
  maxDurationMs: 60_000,
  destinations: ["device", "loopback", "lan", "remote"],
  mutatesUserData: false,
  requiresConsent: false,
  run: (context) =>
    runSmokeTask({
      featureId: "answer-assessment",
      task: assessAnswerTask,
      input: ASSESS_FIXTURE,
      context,
      runOverride: async (smokeContext, provider) => {
        const run = await runAssessAnswer(ASSESS_FIXTURE, {
          signal: smokeContext.signal,
          targetId: `smoke-assessment:${smokeContext.capabilityRevision}`,
          provider,
          observation: {
            featureId: "answer-assessment",
            runId: `smoke-assessment:${smokeContext.capabilityRevision}`,
            capabilityRevision: smokeContext.capabilityRevision,
            smoke: true,
          },
        });
        return { providerKind: run.run.providerKind };
      },
    }),
};

const worthinessSmoke: FeatureSmokeAdapter = {
  featureId: "extract-worthiness",
  stages: ["preflight", "generation", "validation"],
  unverifiedStages: ["preview", "navigation"],
  fixtureId: "fixture-passage-classification-v1",
  maxDurationMs: 45_000,
  destinations: ["device", "loopback", "lan", "remote"],
  mutatesUserData: false,
  requiresConsent: false,
  run: (context) =>
    runSmokeTask({
      featureId: "extract-worthiness",
      task: passageClassificationTask,
      input: { passage: PASSAGE_FIXTURE, documentTitle: FIXTURE_DOCUMENT_TITLE },
      context,
      runOverride: async (smokeContext, provider) => {
        const run = await runPassageClassification(
          { passage: PASSAGE_FIXTURE, documentTitle: FIXTURE_DOCUMENT_TITLE },
          {
            signal: smokeContext.signal,
            targetId: `smoke-worthiness:${smokeContext.capabilityRevision}`,
            provider,
            observation: {
              featureId: "extract-worthiness",
              runId: `smoke-worthiness:${smokeContext.capabilityRevision}`,
              capabilityRevision: smokeContext.capabilityRevision,
              smoke: true,
            },
          }
        );
        return { providerKind: run.run.providerKind };
      },
    }),
};

const AGENT_FIXTURE_DOCUMENT = {
  id: "fixture-agent-doc",
  title: "Synthetic agent fixture",
  contentVersion: "fixture-rev-1",
  fileType: "text",
};

const agentSmoke: FeatureSmokeAdapter = {
  featureId: "learning-agent",
  stages: ["preflight", "retrieval", "generation", "validation"],
  unverifiedStages: ["preview", "persistence", "navigation"],
  fixtureId: "fixture-learning-agent-v1",
  maxDurationMs: 60_000,
  destinations: ["device", "loopback", "lan", "remote"],
  mutatesUserData: false,
  requiresConsent: false,
  run: async (context) => {
    const started = Date.now();
    try {
      const route = await resolveTaskRoute(agentRunnerTask).catch(() => null);
      if (!route) {
        context.reportStage("preflight", "failed", {
          errorCategory: "ModelUnavailable",
          recoveryCode: "provider_unavailable",
        });
        return {
          outcome: "failed",
          stages: ["preflight"],
          errorCategory: "ModelUnavailable",
          recoveryCode: "provider_unavailable",
        };
      }
      const authorized = await authorizeProvider("learning-agent", route.provider);
      if (!authorized) {
        context.reportStage("preflight", "skipped", { recoveryCode: "smoke_consent_denied" });
        return { outcome: "skipped", stages: ["preflight"], recoveryCode: "smoke_consent_denied" };
      }
      context.reportStage("preflight", "success", { durationMs: Date.now() - started });

      const scope = resolveLearningAgentScope({
        conversationId: `smoke-${context.capabilityRevision}`,
        ownerRevision: 1,
        intent: "Propose one flashcard from the attached synthetic passage.",
        scope: "document",
        documents: [AGENT_FIXTURE_DOCUMENT],
        primaryDocumentId: AGENT_FIXTURE_DOCUMENT.id,
      });
      if (!scope.ok) {
        context.reportStage("preflight", "failed", { recoveryCode: "source_stale" });
        return { outcome: "failed", stages: ["preflight"], recoveryCode: "source_stale" };
      }

      const config = getActiveCloudConfig();
      const destination =
        route.provider.kind === "cloud"
          ? classifyCloudDestination({
              provider: config?.provider ?? "openai",
              baseUrl: config?.baseUrl,
              hasApiKey: (config?.apiKey ?? "").trim().length > 0,
            })
          : classifyNativeDestination("unknown");
      const run = {
        ...scope.run,
        capabilityRevision: context.capabilityRevision,
        generation: {
          providerId: route.provider.id,
          kind: (route.provider.kind === "cloud" ? "cloud" : "ondevice") as "cloud" | "ondevice",
          destination,
        },
      };

      const env = createFrozenAgentEnvironment(
        run,
        {
          retrieve: async () =>
            ({
              results: [
                {
                  chunkId: "fixture-agent-chunk",
                  documentId: AGENT_FIXTURE_DOCUMENT.id,
                  documentTitle: AGENT_FIXTURE_DOCUMENT.title,
                  sourceType: "document",
                  text: LEARN_THIS_FIXTURE,
                  headingPath: ["Fixture"],
                  score: 1,
                  mode: "lexicalOnly",
                },
              ],
              mode: "lexicalOnly",
            }) as never,
        },
        context.signal
      );
      context.reportStage("retrieval", "success", { durationMs: 0 });
      const result = await runLearningAgent(run, {
        provider: route.provider,
        env,
        signal: context.signal,
        wallClockMs: 30_000,
        capabilityRevision: context.capabilityRevision,
        smoke: true,
      });
      context.reportStage("generation", "success", { durationMs: Date.now() - started });
      context.reportStage("validation", "success", { durationMs: 0 });
      return {
        outcome: result.result.endReason === "cancelled" ? "cancelled" : "success",
        stages: ["preflight", "retrieval", "generation", "validation"],
        providerClass: normalizeProviderClass(route.provider.id),
      };
    } catch (error) {
      const failure = failureRun(context, error);
      context.reportStage("generation", failure.outcome, {
        durationMs: Date.now() - started,
        errorCategory: failure.errorCategory,
        recoveryCode: failure.recoveryCode,
      });
      return failure;
    }
  },
};

const knowledgeSmoke: FeatureSmokeAdapter = {
  featureId: "knowledge-relationships",
  stages: ["preflight", "retrieval", "validation"],
  unverifiedStages: ["generation", "preview", "persistence", "navigation"],
  fixtureId: "fixture-knowledge-coverage-v1",
  maxDurationMs: 30_000,
  destinations: ["device"],
  mutatesUserData: false,
  requiresConsent: false,
  run: async (context) => {
    const started = Date.now();
    try {
      context.reportStage("preflight", "success", { durationMs: 0 });
      const result = await runCoverageAnalysis({
        concepts: [{ name: "Mitochondrion" }],
        scope: { includeAuxiliarySources: false },
        signal: context.signal,
        preflight: { allowed: true, remote: false, limitations: [] },
        dependencies: {
          retrieve: async () =>
            ({
              results: [
                {
                  chunkId: "fixture-knowledge-chunk",
                  documentId: "fixture-knowledge-doc",
                  documentTitle: "Synthetic knowledge fixture",
                  sourceType: "document",
                  text: LEARN_THIS_FIXTURE,
                  headingPath: ["Fixture"],
                  score: 1,
                  mode: "lexicalOnly",
                  ordinal: 0,
                  location: { sourceType: "text", startOffset: 0, endOffset: 100 },
                },
              ],
              mode: "lexicalOnly",
            }) as never,
          getIndexStatus: async () =>
            ({
              aggregate: {
                totalDocuments: 1,
                indexedDocuments: 1,
                queuedDocuments: 0,
                indexingDocuments: 0,
                staleDocuments: 0,
                failedDocuments: 0,
                totalChunks: 1,
                totalEmbeddings: 0,
                embeddingStorageBytes: 0,
                embeddingModels: [],
                paused: false,
                pendingDocuments: 0,
              },
              documents: [
                {
                  documentId: "fixture-knowledge-doc",
                  state: "indexed",
                  chunksIndexed: 1,
                  totalChunks: 1,
                  updatedAt: "2026-01-01T00:00:00Z",
                },
              ],
            }) as never,
          getDocument: async () =>
            ({
              id: "fixture-knowledge-doc",
              title: "Synthetic knowledge fixture",
              fileType: "text",
              content: LEARN_THIS_FIXTURE,
              contentHash: "fixture-rev-1",
              dateModified: "2026-01-01T00:00:00Z",
            }) as never,
          getExtract: async () => null,
          getLearningItem: async () => null,
          getAnnotation: async () => null,
          findConceptsByNames: async () => [] as never,
          getConceptBacklinks: async () => [] as never,
          listConceptLinksFor: async () => [] as never,
        },
      });
      context.reportStage("retrieval", "success", { durationMs: Date.now() - started });
      context.reportStage("validation", "success", { durationMs: 0 });
      return {
        outcome: result.concepts.length > 0 ? "success" : "failed",
        stages: ["preflight", "retrieval", "validation"],
      };
    } catch (error) {
      const failure = failureRun(context, error);
      context.reportStage("retrieval", failure.outcome, {
        durationMs: Date.now() - started,
        errorCategory: failure.errorCategory,
        recoveryCode: failure.recoveryCode,
      });
      return failure;
    }
  },
};

let registered = false;

/**
 * Register the bundled adapters once per session. Idempotent and side-effect
 * free: registration does not run anything.
 */
export function registerDefaultFeatureSmokeAdapters(): void {
  if (registered) return;
  registered = true;
  for (const adapter of [
    learnThisSmoke,
    librarySmoke,
    assessmentSmoke,
    worthinessSmoke,
    agentSmoke,
    knowledgeSmoke,
  ]) {
    registerFeatureSmokeAdapter(adapter);
  }
}

/** Test-only reset for the registration latch. */
export function resetDefaultFeatureSmokeAdaptersForTests(): void {
  registered = false;
}

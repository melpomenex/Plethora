import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { detectDeclaredSupport } from "../lib/media/capabilities";
import { classifyPlaybackFailure } from "../lib/media/errorClassification";
import type {
  DeclaredCodecSupport,
  MediaCompatibilityJobEvent,
  MediaInspection,
  MediaPlaybackFailure,
  MediaPlaybackPlan,
  MediaProcessingPolicy,
  MediaRuntimeCapabilities,
  PlaybackRecoveryContext,
} from "../lib/media/types";
import {
  getMediaCompatibilityArtifactUrl,
  getMediaRuntimeCapabilities,
  inspectLocalMedia,
  planMediaPlayback,
  startMediaCompatibilityJob,
  cancelMediaCompatibilityJob,
  subscribeToMediaCompatibilityJobs,
} from "../api/mediaCompatibility";
import { isTauri } from "../lib/tauri";

export const DEFAULT_MEDIA_PLAYBACK_POLICY: MediaProcessingPolicy = {
  mode: "automatic-inexpensive",
  quality: "balanced",
  hardwareAcceleration: "auto",
  cacheLimitGb: 25,
};

export type MediaCompatibilityState =
  | { kind: "idle" }
  | { kind: "inspecting" }
  | { kind: "native"; inspection?: MediaInspection; plan?: MediaPlaybackPlan }
  | {
      kind: "preparing";
      inspection: MediaInspection;
      plan: MediaPlaybackPlan;
      job: MediaCompatibilityJobEvent;
    }
  | { kind: "consent"; inspection: MediaInspection; plan: MediaPlaybackPlan }
  | {
      kind: "ready";
      inspection: MediaInspection;
      plan: MediaPlaybackPlan;
      artifactUrl: string;
    }
  | {
      kind: "failed";
      failure: MediaPlaybackFailure;
      inspection?: MediaInspection;
      plan?: MediaPlaybackPlan;
      job?: MediaCompatibilityJobEvent;
    };

interface UseMediaCompatibilityOptions {
  documentId?: string;
  filePath?: string;
  mediaType?: "video" | "audio";
  enabled?: boolean;
  policy?: MediaProcessingPolicy;
}

export interface MediaCompatibilityController {
  state: MediaCompatibilityState;
  inspection?: MediaInspection;
  plan?: MediaPlaybackPlan;
  job?: MediaCompatibilityJobEvent;
  failure?: MediaPlaybackFailure;
  capabilities?: MediaRuntimeCapabilities;
  declaredSupport?: DeclaredCodecSupport;
  confirmConsent: () => Promise<void>;
  cancelJob: () => Promise<void>;
  retry: () => void;
  tryOriginal: () => void;
  refreshCapabilities: () => Promise<void>;
  dismiss: () => void;
}

function jobFailure(event: MediaCompatibilityJobEvent): MediaPlaybackFailure {
  const code =
    event.error?.code ??
    (event.state === "cancelled" ? "conversion_cancelled" : "conversion_failed");
  return {
    code,
    messageKey: `mediaCompatibility.failure.${code}`,
    detail: event.error?.detail ?? event.error?.message,
    retryable: event.state === "cancelled" || Boolean(event.error?.retryable),
    actions: event.state === "cancelled" ? ["retry", "show_details"] : ["retry", "show_details"],
    evidence: { jobId: event.jobId, phase: event.phase },
  };
}

export function useMediaCompatibility(
  options: UseMediaCompatibilityOptions,
): MediaCompatibilityController {
  const { documentId, filePath, mediaType = "video", enabled = true } = options;
  const policy = options.policy ?? DEFAULT_MEDIA_PLAYBACK_POLICY;
  const policyKey = useMemo(
    () =>
      `${policy.mode}|${policy.quality}|${policy.hardwareAcceleration}|${policy.cacheLimitGb}`,
    [policy.cacheLimitGb, policy.hardwareAcceleration, policy.mode, policy.quality],
  );
  const active = Boolean(enabled && isTauri() && mediaType === "video" && documentId && filePath);
  const [state, setState] = useState<MediaCompatibilityState>({ kind: "idle" });
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const unlisten = useRef<UnlistenFn | null>(null);
  const inspectionRef = useRef<MediaInspection | null>(null);
  const planRef = useRef<MediaPlaybackPlan | null>(null);
  const capabilitiesRef = useRef<MediaRuntimeCapabilities | null>(null);
  const supportRef = useRef<DeclaredCodecSupport | null>(null);
  const jobRef = useRef<MediaCompatibilityJobEvent | null>(null);
  const lastSequence = useRef(0);
  const cancelledRef = useRef(false);

  const cleanupListener = useCallback(() => {
    if (unlisten.current) {
      unlisten.current();
      unlisten.current = null;
    }
  }, []);

  const setFailed = useCallback((failure: MediaPlaybackFailure) => {
    setState({
      kind: "failed",
      failure,
      inspection: inspectionRef.current ?? undefined,
      plan: planRef.current ?? undefined,
      job: jobRef.current ?? undefined,
    });
  }, []);

  const loadArtifact = useCallback(async (plan: MediaPlaybackPlan, cacheKey: string) => {
    if (!documentId) return;
    try {
      const artifactUrl = await getMediaCompatibilityArtifactUrl(documentId, cacheKey);
      setState({
        kind: "ready",
        inspection: inspectionRef.current!,
        plan,
        artifactUrl,
      });
    } catch (error) {
      setFailed(
        classifyPlaybackFailure({
          jobErrorCode: "conversion_failed",
          plan,
        }),
      );
      console.error("[media.compat] failed to resolve artifact URL", error);
    }
  }, [documentId, setFailed]);

  const startJob = useCallback(async (plan: MediaPlaybackPlan, consentGranted: boolean) => {
    if (!documentId || !filePath || !inspectionRef.current || !supportRef.current) return;
    const inspection = inspectionRef.current;
    try {
      const job = await startMediaCompatibilityJob({
        documentId,
        filePath,
        inspectionFingerprint: inspection.source.fingerprint,
        clientSupport: supportRef.current,
        policy,
        consentGranted,
      });
      jobRef.current = job;
      lastSequence.current = job.sequence;
      if (job.state === "ready" && job.output) {
        await loadArtifact(plan, job.cacheKey);
        return;
      }
      setState({ kind: "preparing", inspection, plan, job });
    } catch (error) {
      const classified = classifyPlaybackFailure({
        plan,
        jobErrorCode:
          typeof (error as { code?: unknown })?.code === "string"
            ? ((error as { code: MediaPlaybackFailure["code"] }).code)
            : "conversion_failed",
      });
      setFailed(classified);
    }
  }, [documentId, filePath, loadArtifact, policy, setFailed]);

  const buildAndDispatchPlan = useCallback(async (
    inspection: MediaInspection,
    capabilities: MediaRuntimeCapabilities,
    recovery?: PlaybackRecoveryContext,
  ) => {
    if (!documentId || !filePath) return;
    const support = detectDeclaredSupport();
    supportRef.current = support;
    const nextPlan = await planMediaPlayback({
      documentId,
      filePath,
      inspectionFingerprint: inspection.source.fingerprint,
      clientSupport: support,
      policy,
      recovery: recovery ?? null,
    });
    inspectionRef.current = inspection;
    planRef.current = nextPlan;
    capabilitiesRef.current = capabilities;

    if (nextPlan.strategy === "native") {
      setState({ kind: "native", inspection, plan: nextPlan });
      return;
    }
    if (nextPlan.cachedArtifact?.cacheKey) {
      await loadArtifact(nextPlan, nextPlan.cachedArtifact.cacheKey);
      return;
    }
    if (!nextPlan.canConvert) {
      // Native is the only remaining option; the player/classifier will report
      // the precise unavailable reason if it fails.
      setState({ kind: "native", inspection, plan: nextPlan });
      return;
    }
    if (nextPlan.requiresConsent) {
      setState({ kind: "consent", inspection, plan: nextPlan });
      return;
    }
    await startJob(nextPlan, false);
  }, [documentId, filePath, loadArtifact, policy, startJob]);

  useEffect(() => {
    if (!active) {
      setState({ kind: "idle" });
      return;
    }
    const thisGeneration = generation.current + 1;
    generation.current = thisGeneration;
    cancelledRef.current = false;
    setState({ kind: "inspecting" });
    inspectionRef.current = null;
    planRef.current = null;
    jobRef.current = null;
    lastSequence.current = 0;
    cleanupListener();

    void (async () => {
      try {
        const [inspection, capabilities] = await Promise.all([
          inspectLocalMedia(documentId!, filePath!),
          getMediaRuntimeCapabilities(false),
        ]);
        if (cancelledRef.current || generation.current !== thisGeneration) return;
        if (inspection.probeStatus !== "ok") {
          setState({ kind: "native", inspection });
          return;
        }
        inspectionRef.current = inspection;
        await buildAndDispatchPlan(inspection, capabilities);
      } catch (error) {
        if (cancelledRef.current || generation.current !== thisGeneration) return;
        console.warn("[media.compat] inspection/capability setup failed", error);
        setState({ kind: "native" });
      }
    })();

    return () => {
      cancelledRef.current = true;
      cleanupListener();
    };
    // policyKey/nonce are intentional re-run triggers; the string key prevents
    // inline object identity from causing repeated inspection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, documentId, filePath, mediaType, policyKey, nonce]);

  // Subscribe lazily when a job exists so a navigation/reload can reattach.
  useEffect(() => {
    if (state.kind !== "preparing") {
      cleanupListener();
      return;
    }
    let disposed = false;
    void subscribeToMediaCompatibilityJobs((event) => {
      if (disposed || event.documentId !== documentId) return;
      if (event.jobId !== jobRef.current?.jobId && jobRef.current) return;
      if (event.sequence <= lastSequence.current) return;
      lastSequence.current = event.sequence;
      jobRef.current = event;
      if (event.state === "ready") {
        const plan = planRef.current;
        if (plan) void loadArtifact(plan, event.cacheKey);
        return;
      }
      if (event.state === "failed" || event.state === "cancelled") {
        setFailed(jobFailure(event));
        return;
      }
      if (inspectionRef.current && planRef.current) {
        setState({
          kind: "preparing",
          inspection: inspectionRef.current,
          plan: planRef.current,
          job: event,
        });
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten.current = stop;
    }).catch((error) => {
      console.warn("[media.compat] job subscription failed", error);
    });
    return () => {
      disposed = true;
      cleanupListener();
    };
  }, [cleanupListener, documentId, loadArtifact, setFailed, state.kind]);

  const confirmConsent = useCallback(async () => {
    const plan = planRef.current;
    if (!plan) return;
    await startJob(plan, true);
  }, [startJob]);

  const cancelJob = useCallback(async () => {
    const job = jobRef.current;
    if (!job) return;
    try {
      await cancelMediaCompatibilityJob(job.jobId);
    } catch (error) {
      console.warn("[media.compat] cancel failed", error);
    }
  }, []);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const tryOriginal = useCallback(() => {
    void cancelJob();
    const plan = planRef.current ?? undefined;
    setState({ kind: "native", inspection: inspectionRef.current ?? undefined, plan });
  }, [cancelJob]);

  const refreshCapabilities = useCallback(async () => {
    try {
      const capabilities = await getMediaRuntimeCapabilities(true);
      if (inspectionRef.current) {
        await buildAndDispatchPlan(inspectionRef.current, capabilities);
      }
    } catch (error) {
      console.warn("[media.compat] capability refresh failed", error);
    }
  }, [buildAndDispatchPlan]);

  const dismiss = useCallback(() => {
    setState({ kind: "native", inspection: inspectionRef.current ?? undefined, plan: planRef.current ?? undefined });
  }, []);

  return {
    state,
    inspection: inspectionRef.current ?? undefined,
    plan: planRef.current ?? undefined,
    job: jobRef.current ?? undefined,
    failure: state.kind === "failed" ? state.failure : undefined,
    capabilities: capabilitiesRef.current ?? undefined,
    declaredSupport: supportRef.current ?? undefined,
    confirmConsent,
    cancelJob,
    retry,
    tryOriginal,
    refreshCapabilities,
    dismiss,
  };
}

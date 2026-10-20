import {
  claimTranscriptionJob,
  renewTranscriptionLease,
  updateTranscriptionProgressWithLease,
  completeTranscriptionJobWithLease,
  failTranscriptionJobWithLease,
  type TranscriptionQueueEntry,
} from "../../../api/transcription";
import { getDocumentPrivacy } from "../../../lib/documentPrivacy";
import { getTranscriptionService } from "../index";
import { persistSessionTranscriptionUnit } from "../persist";
import type { SessionTranscriptionAuthorization } from "../types";

export interface SessionJobWorkerOptions {
  workerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  supportedExecutors?: string[];
  pollIntervalMs?: number;
}

export class SessionJobWorker {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly supportedExecutors: string[];
  readonly pollIntervalMs: number;

  private isRunning = false;
  private currentJob: TranscriptionQueueEntry | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: SessionJobWorkerOptions = {}) {
    this.workerId = options.workerId || `frontend-worker-${Math.random().toString(36).slice(2, 10)}`;
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.supportedExecutors = options.supportedExecutors ?? ["frontend-service"];
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
  }

  get activeJob(): TranscriptionQueueEntry | null {
    return this.currentJob;
  }

  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Single tick: polls/claims one eligible job and executes it.
   * Returns true if a job was claimed, false otherwise.
   */
  async tick(): Promise<boolean> {
    const job = await claimTranscriptionJob(
      this.workerId,
      this.leaseDurationMs,
      this.supportedExecutors,
    );
    if (!job) return false;

    await this.processClaimedJob(job);
    return true;
  }

  async processClaimedJob(job: TranscriptionQueueEntry): Promise<void> {
    this.currentJob = job;
    this.abortController = new AbortController();
    const cancelEpoch = job.cancelEpoch ?? 0;

    // Start lease renewal heartbeat
    this.heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await renewTranscriptionLease(
          job.id,
          this.workerId,
          this.leaseDurationMs,
          cancelEpoch,
        );
        if (!renewed) {
          this.stopActiveJob("Lease renewal failed or job cancelled");
        }
      } catch {
        this.stopActiveJob("Heartbeat network error");
      }
    }, this.heartbeatIntervalMs);

    try {
      // Re-verify document privacy before executing: local-only or AI-excluded cannot egress to cloud
      const privacy = await getDocumentPrivacy(job.documentId);
      const isLocalPlan =
        job.provider === "local" ||
        job.provider === "apple" ||
        job.provider === "android-ondevice";

      if (privacy.isLocalOnly && !isLocalPlan) {
        throw new Error("Local-only document policy forbids cloud transcription");
      }
      if (privacy.isAiExcluded && !isLocalPlan) {
        throw new Error("AI-excluded document policy forbids cloud transcription");
      }

      // Verify cloud authorization if remote
      if (!isLocalPlan) {
        let auth: SessionTranscriptionAuthorization | undefined;
        if (job.authorizationJson) {
          try {
            auth = JSON.parse(job.authorizationJson);
          } catch {
            // ignore
          }
        }
        if (!auth || !auth.userConsented) {
          throw new Error("Consent required for cloud session transcription");
        }
      }

      // Execute via transcription service
      const service = getTranscriptionService();
      const result = await service.transcribe(
        {
          filePath: job.audioPath,
          documentId: job.documentId,
        },
        {
          language: job.language,
          signal: this.abortController.signal,
          onProgress: (p) => {
            updateTranscriptionProgressWithLease(
              job.id,
              this.workerId,
              p.percent,
              undefined,
              undefined,
              cancelEpoch,
            ).catch(() => {});
          },
        },
      );

      if (this.abortController.signal.aborted) {
        return;
      }

      // If this is a session job, commit the unit and update progress checkpoint atomically
      if (job.sessionId) {
        await persistSessionTranscriptionUnit(result, {
          jobId: job.id,
          sessionId: job.sessionId,
          unitKey: `unit_${job.id}`,
          expectedCancelEpoch: cancelEpoch,
          leaseOwner: this.workerId,
          processedDurationMs:
            result.durationMs ??
            (result.durationSeconds != null ? result.durationSeconds * 1000 : 0),
          totalDurationMs: job.totalDurationMs,
          revision: job.transcriptRevision ?? 0,
        });
      }

      // Mark complete with lease
      await completeTranscriptionJobWithLease(job.id, this.workerId, cancelEpoch);
    } catch (err: any) {
      if (!this.abortController.signal.aborted) {
        await failTranscriptionJobWithLease(
          job.id,
          this.workerId,
          err?.message || "Transcription failed",
          cancelEpoch,
        );
      }
    } finally {
      this.cleanup();
    }
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const loop = async () => {
      if (!this.isRunning) return;
      try {
        const handled = await this.tick();
        const nextDelay = handled ? 100 : this.pollIntervalMs;
        if (this.isRunning) {
          this.pollTimeout = setTimeout(loop, nextDelay);
        }
      } catch {
        if (this.isRunning) {
          this.pollTimeout = setTimeout(loop, this.pollIntervalMs);
        }
      }
    };
    void loop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    this.stopActiveJob("Worker stopped");
    this.cleanup();
  }

  private stopActiveJob(reason: string): void {
    if (this.abortController) {
      this.abortController.abort(new Error(reason));
    }
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.currentJob = null;
    this.abortController = null;
  }
}

let sharedWorker: SessionJobWorker | undefined;

export function getSessionJobWorker(): SessionJobWorker {
  if (!sharedWorker) {
    sharedWorker = new SessionJobWorker();
  }
  return sharedWorker;
}

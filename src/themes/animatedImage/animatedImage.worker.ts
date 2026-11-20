/// <reference lib="webworker" />

import { AnimatedImagePreparationError } from "./contracts";
import { prepareGif } from "./gifComposer";

interface PrepareMessage {
  readonly type: "prepare";
  readonly generation: number;
  readonly mediaId: string;
  readonly tier: "desktop" | "mobile";
  readonly bytes: ArrayBuffer;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PrepareMessage>) => void) | null;
  postMessage(message: unknown): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  if (!request || request.type !== "prepare") return;
  let current = true;
  void prepareGif({
    bytes: new Uint8Array(request.bytes),
    mediaId: request.mediaId,
    tier: request.tier,
    isCurrent: () => current,
    progress: (stage, fraction) => {
      workerScope.postMessage({
        type: "progress",
        generation: request.generation,
        stage,
        fraction,
      });
    },
  }).then((prepared) => {
    if (current) {
      workerScope.postMessage({ type: "result", generation: request.generation, prepared });
    }
  }).catch((error) => {
    const failure = error instanceof AnimatedImagePreparationError
      ? error
      : new AnimatedImagePreparationError("decode-failed", "The GIF could not be prepared safely.");
    if (current) {
      workerScope.postMessage({
        type: "error",
        generation: request.generation,
        code: failure.code,
        message: failure.message,
        capability: failure.capability,
      });
    }
  });
};

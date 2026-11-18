export const STARTUP_DEADLINE_MS = 15_000;

type Failure = "timeout" | "error";

export function createFrontendStartupAttempt(requireLocalData: boolean, onFailure: (failure: Failure) => void) {
  let mainReady = false;
  let localReady = !requireLocalData;
  let status: "pending" | "ready" | "failed" = "pending";
  const timer = setTimeout(() => fail("timeout"), STARTUP_DEADLINE_MS);

  function fail(failure: Failure) {
    if (status !== "pending") return;
    status = "failed";
    clearTimeout(timer);
    onFailure(failure);
  }

  function finishIfReady() {
    if (status !== "pending" || !mainReady || !localReady) return;
    status = "ready";
    clearTimeout(timer);
  }

  return {
    get failed() { return status === "failed"; },
    mainLoaded() { mainReady = true; finishIfReady(); },
    dataLoaded() { localReady = true; finishIfReady(); },
    fail,
  };
}

export type FrontendStartupAttempt = ReturnType<typeof createFrontendStartupAttempt>;

declare global {
  interface Window {
    __plethoraStartupAttempt?: FrontendStartupAttempt;
  }
}

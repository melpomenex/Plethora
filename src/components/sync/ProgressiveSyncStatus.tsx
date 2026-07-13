import { useEffect, useState, type ReactElement } from "react";
import { getProgressiveSyncScheduler, type ProgressiveSyncScheduler } from "../../lib/sync/progressiveScheduler";

type Status = "up-to-date" | "catching-up" | "paused" | "attention";

function getStatus(scheduler: ProgressiveSyncScheduler): Status {
  const stats = scheduler.stats();
  if (scheduler.health().quarantinedDomains.length > 0) return "attention";
  if (stats.queued > 0) {
    if (typeof document !== "undefined" && document.hidden) return "paused";
    return "catching-up";
  }
  return "up-to-date";
}

export function ProgressiveSyncStatus(): ReactElement {
  const [scheduler] = useState(() => getProgressiveSyncScheduler());
  const [status, setStatus] = useState<Status>(() => getStatus(scheduler));
  useEffect(() => {
    const update = () => setStatus(getStatus(scheduler));
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [scheduler]);
  const labels: Record<Status, string> = {
    "up-to-date": "Up to date",
    "catching-up": "Catching up",
    paused: "Paused to keep the app responsive",
    attention: "Needs attention",
  };
  const quarantined = scheduler.health().quarantinedDomains;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <span>{labels[status]}</span>
      {quarantined.length > 0 && (
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => quarantined.forEach((domain) => scheduler.resetCircuit(domain))}
        >
          Retry
        </button>
      )}
    </div>
  );
}

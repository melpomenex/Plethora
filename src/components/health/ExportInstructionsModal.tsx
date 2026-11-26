import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import type { HealthProviderId, ProviderExportGuide } from "../../types/health";
import { Button } from "../md3/Button";
import { HealthDialog } from "./HealthDialog";

export function ExportInstructionsModal({
  initialProviderId,
  onClose,
  onStartImport,
}: {
  initialProviderId?: HealthProviderId | null;
  onClose: () => void;
  onStartImport: (providerId: HealthProviderId) => void;
}) {
  const [guides, setGuides] = useState<ProviderExportGuide[]>([]);
  const [selectedId, setSelectedId] = useState<HealthProviderId>(
    initialProviderId ?? "garmin",
  );

  useEffect(() => {
    void healthApi
      .getProviderExportGuides()
      .then((list) => {
        setGuides(list);
        if (initialProviderId && list.some((g) => g.providerId === initialProviderId)) {
          setSelectedId(initialProviderId);
        }
      })
      .catch(() => {});
  }, [initialProviderId]);

  const active = guides.find((g) => g.providerId === selectedId) ?? guides[0];

  return (
    <HealthDialog title="How to export your wearable data" onClose={onClose}>
      <div className="health-form">
        <label>
          Wearable provider
          <select
            value={active?.providerId ?? selectedId}
            onChange={(e) => setSelectedId(e.target.value as HealthProviderId)}
          >
            {guides.map((g) => (
              <option key={g.providerId} value={g.providerId}>
                {g.displayName} — {g.readinessLabel}
              </option>
            ))}
          </select>
        </label>

        {active && (
          <div className="health-export-guide">
            <p>
              <strong>Status:</strong> {active.readinessLabel} (verified {active.lastVerifiedDate})
            </p>
            <p>
              <strong>Supported formats:</strong> {active.supportedExportFormats.join(" · ")}
            </p>
            <ol className="health-guide-steps">
              {active.exportSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {active.limitations.length > 0 && (
              <ul className="health-reasons">
                {active.limitations.map((lim) => (
                  <li key={lim}>{lim}</li>
                ))}
              </ul>
            )}
            <div className="health-actions health-actions-start">
              <a
                href={active.officialPortalUrl}
                target="_blank"
                rel="noreferrer"
                className="health-portal-link"
              >
                Open official export portal <ArrowSquareOut size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}

        <div className="health-actions">
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
          {active?.fileImportAvailable && (
            <Button
              variant="filled"
              onClick={() => {
                onClose();
                onStartImport(active.providerId);
              }}
            >
              Import {active.displayName} export
            </Button>
          )}
        </div>
      </div>
    </HealthDialog>
  );
}

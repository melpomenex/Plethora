import { useEffect, useState } from "react";
import { CheckCircle, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import { listen } from "../../lib/tauri";
import { useHealthStore } from "../../stores/healthStore";
import type {
  CsvMappingProfile,
  HealthDataCategory,
  HealthProviderId,
  ImportAdapterDescriptor,
  ImportCommitResult,
  ImportPreview,
  ImportProgressEvent,
} from "../../types/health";
import { Button } from "../md3/Button";
import { HealthDialog } from "./HealthDialog";
import { dateLabel, healthError } from "./healthFormat";

const categoryLabels: Record<HealthDataCategory, string> = {
  sleep: "Sleep sessions",
  sleep_stages: "Sleep stages",
  heart_rate: "Heart rate",
  resting_heart_rate: "Resting heart rate",
  hrv: "HRV",
  activity: "Activity",
  recovery: "Recovery & scores",
  temperature: "Temperature",
  respiratory_rate: "Respiratory rate",
};

const providerNames: Record<HealthProviderId, string> = {
  apple_healthkit: "Apple Health / Apple Watch",
  android_health_connect: "Android Health Connect",
  oura: "Oura Ring",
  whoop: "WHOOP",
  google_health: "Google Health / Fitbit",
  garmin: "Garmin",
  polar: "Polar",
  withings: "Withings",
  samsung_health: "Samsung Health",
  suunto: "Suunto",
  ultrahuman: "Ultrahuman Ring",
  ringconn: "RingConn",
  manual: "Manual Sleep Entry",
  file_import: "Generic File Import",
};

function formatDateMs(ms: number | null) {
  if (ms == null) return "—";
  return dateLabel(new Date(ms).toISOString().slice(0, 10));
}

export function UniversalWearableImportDialog({
  initialFilePath,
  initialProviderHint,
  onClose,
  onCompleted,
}: {
  initialFilePath?: string | null;
  initialProviderHint?: HealthProviderId | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const setView = useHealthStore((state) => state.setView);
  const invalidate = useHealthStore((state) => state.invalidate);

  const [adapters, setAdapters] = useState<ImportAdapterDescriptor[]>([]);
  const [profiles, setProfiles] = useState<CsvMappingProfile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>(() =>
    initialFilePath ? [initialFilePath] : [],
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overrideAdapterId, setOverrideAdapterId] = useState<string>("");
  const [providerOverride, setProviderOverride] = useState<HealthProviderId | "">(
    initialProviderHint ?? "",
  );
  const [selectedCategories, setSelectedCategories] = useState<HealthDataCategory[]>([]);
  const [mapping, setMapping] = useState<CsvMappingProfile>({
    name: "Custom CSV Profile",
    durationUnit: "minutes",
    temperatureUnit: "C",
    hrvMethod: "unknown",
    stageLabelMap: {},
  });
  const [showMapper, setShowMapper] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    void Promise.all([healthApi.listImportAdapters(), healthApi.listCsvMappingProfiles()])
      .then(([adps, profs]) => {
        setAdapters(adps);
        setProfiles(profs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sub = listen<ImportProgressEvent>("health-import-progress", ({ payload }) => {
      if (!jobId || payload.jobId === jobId) {
        setProgress(payload);
      }
    });
    return () => {
      void sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [jobId]);

  useEffect(() => {
    if (initialFilePath) {
      void runPreview(initialFilePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilePath]);

  async function runPreview(
    filePath: string,
    adapterId?: string | null,
    csvMapping?: CsvMappingProfile | null,
  ) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const prev = await healthApi.previewWearableImport(
        filePath,
        adapterId || null,
        csvMapping || null,
      );
      setPreview(prev);
      setSelectedCategories(prev.availableCategories.map((c) => c.category));
      if (prev.detection.requiresCsvMapping && !csvMapping) {
        setShowMapper(true);
      }
      if (prev.selectedProviderId && !providerOverride) {
        setProviderOverride(prev.selectedProviderId);
      }
    } catch (cause) {
      setError(healthError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function pickFiles() {
    setError("");
    try {
      const files = await healthApi.pickWearableImportFiles();
      if (files.length === 0) return;
      setSelectedFiles(files);
      await runPreview(files[0]);
    } catch (cause) {
      setError(healthError(cause));
    }
  }

  async function handleCommit() {
    if (!preview) return;
    const activeJob = `impjob_${Date.now()}`;
    setJobId(activeJob);
    setBusy(true);
    setError("");
    setProgress({
      jobId: activeJob,
      phase: "starting",
      processed: 0,
      total: null,
      message: "Preparing local import...",
    });
    try {
      let lastRes: ImportCommitResult | null = null;
      const filesToCommit = selectedFiles.length > 0 ? selectedFiles : [preview.filePath];
      for (const filePath of filesToCommit) {
        lastRes = await healthApi.commitWearableImport({
          jobId: activeJob,
          filePath,
          adapterId: overrideAdapterId || preview.selectedAdapterId,
          providerOverride: providerOverride || preview.selectedProviderId,
          selectedCategories,
          mappingProfile: showMapper ? mapping : null,
        });
      }
      if (lastRes) {
        setResult(lastRes);
        invalidate();
        onCompleted();
      }
    } catch (cause) {
      setError(healthError(cause));
    } finally {
      setBusy(false);
      setProgress(null);
      setJobId(null);
    }
  }

  async function handleCancelImport() {
    if (jobId) {
      await healthApi.cancelWearableImport(jobId).catch(() => {});
    }
  }

  async function handleSaveProfile() {
    try {
      const saved = await healthApi.saveCsvMappingProfile(mapping);
      setProfiles((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      await runPreview(preview!.filePath, "generic_csv", saved);
    } catch (cause) {
      setError(healthError(cause));
    }
  }

  return (
    <HealthDialog title="Import Wearable Data" onClose={busy ? () => {} : onClose}>
      <div className="health-form">
        {!result && (
          <>
            <div
              className={`health-dropzone${dragActive ? " health-dropzone-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const dropped = Array.from(e.dataTransfer.files)
                  .map((f) => (f as File & { path?: string }).path)
                  .filter((p): p is string => Boolean(p));
                if (dropped.length > 0) {
                  setSelectedFiles(dropped);
                  void runPreview(dropped[0]);
                } else {
                  setError("Use 'Select export file' to browse files on this platform.");
                }
              }}
            >
              <FileArrowUp size={28} aria-hidden="true" />
              <p>
                Select an original wearable export (<code>.zip</code>, <code>.xml</code>,{" "}
                <code>.csv</code>, or <code>.json</code>). Archives are read locally without
                manual extraction.
              </p>
              <Button variant="tonal" disabled={busy} onClick={() => void pickFiles()}>
                {preview ? "Choose different file" : "Select export file"}
              </Button>
            </div>

            {selectedFiles.length > 1 && (
              <p className="health-hint">
                {selectedFiles.length} files selected (previewing first file; all selected files
                will import with the same settings).
              </p>
            )}
          </>
        )}

        {preview && !result && (
          <div className="health-import-preview">
            <div className="health-preview-header">
              <strong>
                {preview.selectedProviderId
                  ? `${providerNames[preview.selectedProviderId]} export detected`
                  : "Format inspection"}
              </strong>
              <span>{preview.detection.explanation}</span>
            </div>

            {preview.detection.confidence === "ambiguous" && (
              <label>
                Confirm format adapter
                <select
                  value={overrideAdapterId || preview.selectedAdapterId || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOverrideAdapterId(val);
                    void runPreview(preview.filePath, val, null);
                  }}
                >
                  {adapters.map((a) => (
                    <option key={a.adapterId} value={a.adapterId}>
                      {a.formatLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(preview.detection.confidence === "unknown" || showMapper) &&
              preview.sampleCsvHeaders.length > 0 && (
                <div className="health-csv-mapper">
                  <h4>CSV Column Mapping Wizard</h4>
                  {profiles.length > 0 && (
                    <label>
                      Load saved mapping profile
                      <select
                        value=""
                        onChange={(e) => {
                          const found = profiles.find((p) => p.id === e.target.value);
                          if (found) {
                            setMapping(found);
                            void runPreview(preview.filePath, "generic_csv", found);
                          }
                        }}
                      >
                        <option value="">Select saved profile...</option>
                        {profiles.map((p) => (
                          <option key={p.id ?? p.name} value={p.id ?? ""}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="health-mapper-grid">
                    <label>
                      Profile name
                      <input
                        type="text"
                        value={mapping.name}
                        onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                      />
                    </label>
                    <label>
                      Provider attribution
                      <select
                        value={mapping.providerId ?? "file_import"}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            providerId: e.target.value as HealthProviderId,
                          })
                        }
                      >
                        {Object.entries(providerNames).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Start timestamp column
                      <select
                        value={mapping.startColumn ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, startColumn: e.target.value || null })
                        }
                      >
                        <option value="">(None / use Date + Duration)</option>
                        {preview.sampleCsvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      End timestamp column
                      <select
                        value={mapping.endColumn ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, endColumn: e.target.value || null })
                        }
                      >
                        <option value="">(None)</option>
                        {preview.sampleCsvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Duration column
                      <select
                        value={mapping.durationColumn ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, durationColumn: e.target.value || null })
                        }
                      >
                        <option value="">(Derive from start/end)</option>
                        {preview.sampleCsvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Duration unit
                      <select
                        value={mapping.durationUnit ?? "minutes"}
                        onChange={(e) => setMapping({ ...mapping, durationUnit: e.target.value })}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="seconds">Seconds</option>
                        <option value="hours">Hours</option>
                      </select>
                    </label>
                    <label>
                      HRV column
                      <select
                        value={mapping.hrvColumn ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, hrvColumn: e.target.value || null })
                        }
                      >
                        <option value="">(None)</option>
                        {preview.sampleCsvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Resting HR column
                      <select
                        value={mapping.restingHrColumn ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, restingHrColumn: e.target.value || null })
                        }
                      >
                        <option value="">(None)</option>
                        {preview.sampleCsvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="health-actions health-actions-start">
                    <Button
                      variant="tonal"
                      disabled={busy}
                      onClick={() => void runPreview(preview.filePath, "generic_csv", mapping)}
                    >
                      Preview mapping
                    </Button>
                    <Button variant="text" disabled={busy} onClick={() => void handleSaveProfile()}>
                      Save &amp; apply profile
                    </Button>
                  </div>
                </div>
              )}

            {preview.canCommit && (
              <>
                <dl className="health-metrics">
                  <div>
                    <dt>Sleep sessions</dt>
                    <dd>{preview.sleepSessionsCount}</dd>
                  </div>
                  <div>
                    <dt>Stage records</dt>
                    <dd>{preview.sleepStagesCount}</dd>
                  </div>
                  <div>
                    <dt>Biometrics</dt>
                    <dd>{preview.physioObservationsCount}</dd>
                  </div>
                  <div>
                    <dt>Recovery / scores</dt>
                    <dd>{preview.recoveryObservationsCount}</dd>
                  </div>
                  <div>
                    <dt>Date range</dt>
                    <dd>
                      {formatDateMs(preview.dateRangeStartMs)} –{" "}
                      {formatDateMs(preview.dateRangeEndMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>New / existing</dt>
                    <dd>
                      {preview.estimatedNew} new · {preview.estimatedDuplicates} existing
                    </dd>
                  </div>
                </dl>

                {preview.availableCategories.length > 0 && (
                  <fieldset className="health-choice-list">
                    <legend>Categories to import</legend>
                    {preview.availableCategories.map((c) => (
                      <label key={c.category}>
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(c.category)}
                          onChange={(e) =>
                            setSelectedCategories((cur) =>
                              e.target.checked
                                ? [...cur, c.category]
                                : cur.filter((x) => x !== c.category),
                            )
                          }
                        />
                        {categoryLabels[c.category]} ({c.count})
                      </label>
                    ))}
                  </fieldset>
                )}
              </>
            )}

            {preview.timezoneAssumptions.map((note) => (
              <p key={note} className="health-warning">
                <WarningCircle size={16} aria-hidden="true" /> {note}
              </p>
            ))}
            {preview.warnings.map((w) => (
              <p key={w} className="health-warning">
                <WarningCircle size={16} aria-hidden="true" /> {w}
              </p>
            ))}
          </div>
        )}

        {progress && (
          <div className="health-import-progress" role="status" aria-live="polite">
            <p>{progress.message}</p>
            <progress
              value={progress.total ? progress.processed : undefined}
              max={progress.total ?? undefined}
            />
          </div>
        )}

        {result && (
          <div className="health-import-complete">
            <h4>
              <CheckCircle size={20} aria-hidden="true" /> Import complete
            </h4>
            <dl className="health-metrics">
              <div>
                <dt>Sleep added / updated</dt>
                <dd>
                  {result.sleepImported} / {result.sleepUpdated}
                </dd>
              </div>
              <div>
                <dt>Biometrics</dt>
                <dd>{result.physioImported}</dd>
              </div>
              <div>
                <dt>Recovery scores</dt>
                <dd>{result.recoveryImported}</dd>
              </div>
              <div>
                <dt>Skipped rows</dt>
                <dd>{result.sleepSkipped}</dd>
              </div>
            </dl>
            {!result.hasUsableSleep && (
              <p className="health-warning">
                <WarningCircle size={16} aria-hidden="true" /> No usable sleep sessions were found
                in this export; only biometric/recovery records were imported.
              </p>
            )}
            <div className="health-actions">
              <Button variant="text" onClick={onClose}>
                Done
              </Button>
              <Button
                variant="filled"
                onClick={() => {
                  setView("sleep-chart");
                  onClose();
                }}
              >
                Open Sleep Chart
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="health-error">
            {error}
          </p>
        )}

        {!result && (
          <div className="health-actions">
            {busy && jobId ? (
              <Button variant="destructive" onClick={() => void handleCancelImport()}>
                Cancel import
              </Button>
            ) : (
              <Button variant="text" onClick={onClose}>
                Close
              </Button>
            )}
            {preview?.canCommit && (
              <Button
                variant="filled"
                disabled={busy || selectedCategories.length === 0}
                onClick={() => void handleCommit()}
              >
                Import selected data
              </Button>
            )}
          </div>
        )}
      </div>
    </HealthDialog>
  );
}

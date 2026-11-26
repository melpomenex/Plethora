import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourcesPanel } from "../DataSourcesPanel";
import { useHealthStore } from "../../../stores/healthStore";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  invokeCommand: mocks.invoke,
  listen: mocks.listen,
}));

describe("Universal Wearable Import UX", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) { this.open = true; },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) { this.open = false; },
    });
    useHealthStore.setState({ view: "data-sources", demo: false, includeLearning: false, revision: 0 });

    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "health_list_providers":
          return [
            {
              id: "garmin",
              category: "cloud_oauth",
              displayName: "Garmin",
              supportedCategories: ["sleep", "recovery"],
              readinessState: "requires_developer_approval",
              readinessReason: "Cloud sync requires commercial approval",
              implementationVersion: "1.0.0",
              requiresApproval: true,
              requiresCredentials: true,
              supportsBackfill: false,
              maxBackfillDays: 30,
              bridgedVia: [],
              documentationUrl: "",
              limitations: [],
            },
          ];
        case "health_get_connections":
        case "health_get_source_preferences":
        case "health_get_consent_log":
        case "health_list_csv_mapping_profiles":
        case "health_list_watched_folders":
          return [];
        case "health_list_import_adapters":
          return [
            {
              adapterId: "garmin_account_export",
              providerId: "garmin",
              displayName: "Garmin",
              formatId: "garmin_connect_export",
              formatLabel: "Garmin Account Data Export (ZIP / sleepData.json)",
              formatVersion: "1.0",
              verificationStatus: "implemented_fixture_tested",
              capabilities: {
                supportsArchive: true,
                supportsStandalone: true,
                supportsDetailedStages: true,
                supportsStageTotalsOnly: true,
                supportsTimezone: true,
                supportedExtensions: ["zip", "json"],
                supportedCategories: ["sleep", "sleep_stages", "recovery"],
                knownLimitations: [],
              },
            },
          ];
        case "health_get_provider_export_guides":
          return [
            {
              providerId: "garmin",
              displayName: "Garmin",
              fileImportAvailable: true,
              verificationStatus: "implemented_fixture_tested",
              supportedExportFormats: ["Garmin Account Data Management ZIP"],
              exportSteps: ["Sign in to Garmin Account Management and request export."],
              officialPortalUrl: "https://www.garmin.com/en-US/account/datamanagement/exportdata",
              availableCategories: ["sleep", "sleep_stages"],
              limitations: [],
              nativeBridgeAvailable: true,
              cloudSyncRequiresApproval: true,
              readinessLabel: "Native export import available",
              lastVerifiedDate: "2026-11-26",
            },
          ];
        case "health_list_import_batches":
          return [
            {
              id: "impbatch_1",
              providerId: "garmin",
              acquisitionMethod: "file_import",
              exportFormat: "garmin_connect_zip",
              formatVersion: "1.0",
              sourceFileName: "garmin-export.zip",
              fileSizeBytes: 2048,
              importedAtMs: 1791172800000,
              dateRangeStartMs: 1791086400000,
              dateRangeEndMs: 1791172800000,
              sleepAdded: 12,
              sleepUpdated: 0,
              sleepSkipped: 0,
              physioImported: 12,
              recoveryImported: 12,
              warnings: [],
              status: "completed",
            },
          ];
        case "health_pick_wearable_import_files":
          return ["/tmp/garmin-export.zip"];
        case "health_preview_wearable_import":
          return {
            filePath: "/tmp/garmin-export.zip",
            fileName: "garmin-export.zip",
            fileSizeBytes: 2048,
            fileHash: "abc123",
            detection: {
              confidence: "confident",
              primary: {
                providerId: "garmin",
                adapterId: "garmin_account_export",
                formatId: "garmin_connect_zip",
                formatLabel: "Garmin Connect Account Export (.zip)",
                confidence: "confident",
                score: 98,
                reasons: ["Archive contains DI_CONNECT sleepData JSON"],
              },
              candidates: [],
              fileKind: "zip",
              isArchive: true,
              requiresCsvMapping: false,
              explanation: "Archive contains DI_CONNECT sleepData JSON",
            },
            selectedProviderId: "garmin",
            selectedAdapterId: "garmin_account_export",
            dateRangeStartMs: 1791086400000,
            dateRangeEndMs: 1791172800000,
            availableCategories: [{ category: "sleep", count: 12 }],
            sleepSessionsCount: 12,
            sleepStagesCount: 48,
            physioObservationsCount: 12,
            recoveryObservationsCount: 12,
            estimatedNew: 12,
            estimatedDuplicates: 0,
            estimatedUpdates: 0,
            invalidRecords: 0,
            missingFields: [],
            unsupportedFields: [],
            timezoneAssumptions: [],
            warnings: [],
            sampleCsvHeaders: [],
            sampleCsvRows: [],
            canCommit: true,
          };
        case "health_commit_wearable_import":
          return {
            batchId: "impbatch_2",
            providerId: "garmin",
            acquisitionMethod: "file_import",
            exportFormat: "garmin_connect_zip",
            sleepImported: 12,
            sleepUpdated: 0,
            sleepSkipped: 0,
            physioImported: 12,
            recoveryImported: 12,
            reconciledEpisodes: 12,
            dateRangeStartMs: 1791086400000,
            dateRangeEndMs: 1791172800000,
            warnings: [],
            rowErrors: [],
            hasUsableSleep: true,
          };
        case "health_delete_import_batch":
          return true;
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens Import Wearable Data, previews a Garmin archive, and commits it", async () => {
    render(<DataSourcesPanel />);
    const importBtn = await screen.findByRole("button", { name: /Import Wearable Data/i });
    fireEvent.click(importBtn);

    const selectBtn = await screen.findByRole("button", { name: /Select export file/i });
    fireEvent.click(selectBtn);

    expect(await screen.findByText(/Garmin export detected/i)).toBeTruthy();
    const commitBtn = await screen.findByRole("button", { name: /Import selected data/i });
    fireEvent.click(commitBtn);

    expect(await screen.findByText(/Import complete/i)).toBeTruthy();
  });

  it("displays import history and deletes a batch after confirmation", async () => {
    render(<DataSourcesPanel />);
    expect(await screen.findByText(/garmin-export\.zip/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Delete batch/i }));
    const dialog = await screen.findByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete batch$/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("health_delete_import_batch", { batchId: "impbatch_1" });
    });
  });
});

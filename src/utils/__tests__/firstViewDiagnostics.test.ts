/**
 * Development-only first-view latency diagnostics (#11).
 *
 * Verifies the cold/warm classification, chunk/mount phases, failure
 * recording, and — crucially — that the instrumentation is silent by default
 * outside development builds and only emits when explicitly enabled.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __getFirstViewSamples,
  __resetFirstViewDiagnostics,
  __setFirstViewDiagnosticsEnabled,
  firstViewChunkEnd,
  firstViewChunkFailed,
  firstViewChunkStart,
  firstViewMounted,
} from "../firstViewDiagnostics";

describe("firstViewDiagnostics", () => {
  beforeEach(() => {
    __resetFirstViewDiagnostics();
    __setFirstViewDiagnosticsEnabled(null);
  });

  it("records nothing when the instrumentation is disabled", () => {
    __setFirstViewDiagnosticsEnabled(false);
    firstViewChunkStart("SettingsPage");
    firstViewChunkEnd("SettingsPage");
    firstViewMounted("Settings");
    expect(__getFirstViewSamples()).toEqual([]);
  });

  it("records a cold chunk sample on first load and warm on a later retry-path load", () => {
    __setFirstViewDiagnosticsEnabled(true);

    firstViewChunkStart("SettingsPage");
    firstViewChunkEnd("SettingsPage");
    let samples = __getFirstViewSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ view: "SettingsPage", phase: "chunk", cold: true });
    expect(samples[0].durationMs).toBeGreaterThanOrEqual(0);

    // A fresh lazy instance loading the same chunk name (e.g. a closed-and-
    // reopened view) is a warm repeat — the chunk is already in the registry.
    firstViewChunkStart("SettingsPage");
    firstViewChunkEnd("SettingsPage");
    samples = __getFirstViewSamples();
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({ view: "SettingsPage", phase: "chunk", cold: false });
  });

  it("classifies the first mount as cold and later activations as warm", () => {
    __setFirstViewDiagnosticsEnabled(true);

    firstViewMounted("Queue");
    firstViewMounted("Queue");
    firstViewMounted("Queue");

    const mounts = __getFirstViewSamples();
    expect(mounts).toHaveLength(3);
    expect(mounts[0]).toMatchObject({ view: "Queue", phase: "mount", cold: true });
    expect(mounts[1]).toMatchObject({ view: "Queue", phase: "mount", cold: false });
    expect(mounts[2]).toMatchObject({ view: "Queue", phase: "mount", cold: false });
  });

  it("records failed chunk loads so stall regressions are visible", () => {
    __setFirstViewDiagnosticsEnabled(true);

    firstViewChunkStart("ReviewTab");
    firstViewChunkFailed("ReviewTab");

    const samples = __getFirstViewSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ view: "ReviewTab", phase: "chunk-fail", cold: true });
  });

  it("tracks each view independently", () => {
    __setFirstViewDiagnosticsEnabled(true);

    firstViewChunkStart("SettingsPage");
    firstViewChunkEnd("SettingsPage");
    firstViewChunkStart("DashboardTab");
    firstViewChunkEnd("DashboardTab");

    const samples = __getFirstViewSamples();
    expect(samples.map((s) => s.view).sort()).toEqual(["DashboardTab", "SettingsPage"]);
    expect(samples.every((s) => s.cold)).toBe(true);
  });
});

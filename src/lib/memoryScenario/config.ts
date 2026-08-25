/**
 * Memory-scenario configuration discovery.
 *
 * The webview cannot read process environment variables, so the Rust command
 * `get_memory_scenario_config` is the single bridge: it returns the harness
 * config only when PLETHORA_MEMORY_SCENARIO and PLETHORA_MEMORY_CONTROL are
 * both set in the launched app's environment, and null otherwise.
 */

import { invokeCommand } from "../tauri";
import type { MemoryScenarioConfig } from "./types";

const COMMAND = "get_memory_scenario_config";

/**
 * Fetch the scenario config. Returns null — and the host stays inert — unless
 * the harness environment is present.
 */
export async function getMemoryScenarioConfig(): Promise<MemoryScenarioConfig | null> {
  try {
    const config = await invokeCommand<MemoryScenarioConfig | null>(COMMAND);
    if (!config) return null;
    if (!config.controlUrl || !config.runId) return null;
    return config;
  } catch {
    // The command is registered on desktop only; any failure means no harness.
    return null;
  }
}

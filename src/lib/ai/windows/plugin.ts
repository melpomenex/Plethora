/**
 * Invoke helper for `plugin:plethora-windows-intelligence`.
 */

import { invokeCommand } from "../../tauri";

export const WINDOWS_INTELLIGENCE_PLUGIN = "plugin:plethora-windows-intelligence";

export function windowsCommand(name: string): string {
  return `${WINDOWS_INTELLIGENCE_PLUGIN}|${name}`;
}

export async function invokeWindows<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return invokeCommand<T>(windowsCommand(command), args);
}

/**
 * Invoke helper for `plugin:plethora-apple-intelligence`.
 */

import { invokeCommand } from "../../tauri";

export const APPLE_INTELLIGENCE_PLUGIN = "plugin:plethora-apple-intelligence";

export function appleCommand(name: string): string {
  return `${APPLE_INTELLIGENCE_PLUGIN}|${name}`;
}

export async function invokeApple<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return invokeCommand<T>(appleCommand(command), args);
}

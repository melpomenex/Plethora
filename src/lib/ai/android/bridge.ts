/**
 * Desktop-safe IPC helpers for sibling Android AI plugins.
 * Missing plugins / non-Android runtimes map to `platform_unsupported`.
 */

import { invokeCommand, isNativeMobile, isTauri, nativePlatform } from "../../tauri";
import { OnDeviceAiError, toOnDeviceAiError } from "../onDeviceAI";

export function isAndroidAiPluginPlatform(): boolean {
  if (!isTauri() || !isNativeMobile()) return false;
  const platform = nativePlatform();
  return platform === null ? true : platform === "android";
}

export async function invokeAndroidPlugin<T>(
  plugin: string,
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isAndroidAiPluginPlatform()) {
    throw new OnDeviceAiError(
      "platform_unsupported",
      `${plugin} is only available in the Android build.`
    );
  }
  try {
    return await invokeCommand<T>(`plugin:${plugin}|${command}`, args);
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

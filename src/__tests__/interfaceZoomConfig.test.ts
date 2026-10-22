import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const capabilityPath = path.join(root, "src-tauri/capabilities/interface-zoom.json");
const confPath = path.join(root, "src-tauri/tauri.conf.json");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

describe("interface zoom native configuration", () => {
  it("grants only the WebView zoom setter, only to the main webview", () => {
    const capability = readJson<{
      identifier: string;
      windows: string[];
      webviews: string[];
      permissions: string[];
    }>(capabilityPath);

    expect(capability.identifier).toBe("interface-zoom");
    expect(capability.windows).toEqual(["main"]);
    expect(capability.webviews).toEqual(["main"]);
    expect(capability.permissions).toEqual(["core:webview:allow-set-webview-zoom"]);
  });

  it("keeps the built-in WebView2/Tauri zoom hotkeys disabled", () => {
    const conf = readJson<{ app?: { zoomHotkeysEnabled?: boolean } }>(confPath);
    expect(conf.app?.zoomHotkeysEnabled).not.toBe(true);
  });
});

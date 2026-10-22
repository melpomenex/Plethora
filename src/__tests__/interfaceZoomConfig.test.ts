import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const capabilityPath = path.join(root, "src-tauri/capabilities/interface-zoom.json");
const defaultCapabilityPath = path.join(
  root,
  "src-tauri/capabilities/default.json",
);
const confPath = path.join(root, "src-tauri/tauri.conf.json");

type RemoteCapability = {
  identifier: string;
  remote?: { urls: string[] };
  windows: string[];
  webviews: string[];
  permissions: string[];
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

describe("interface zoom native configuration", () => {
  it("grants only the WebView zoom setter, only to the main webview", () => {
    const capability = readJson<RemoteCapability>(capabilityPath);

    expect(capability.identifier).toBe("interface-zoom");
    expect(capability.windows).toEqual(["main"]);
    expect(capability.webviews).toEqual(["main"]);
    expect(capability.permissions).toEqual(["core:webview:allow-set-webview-zoom"]);
  });

  it("also applies to the localhost origin the packaged app is served from", () => {
    // Desktop release builds navigate the main webview to the plugin-localhost
    // server, so Tauri treats the page as a remote origin and a local-only
    // capability is never consulted. Without this the native zoom command is
    // rejected and the controller rolls every change back.
    const capability = readJson<RemoteCapability>(capabilityPath);
    const defaults = readJson<RemoteCapability>(defaultCapabilityPath);

    expect(capability.remote?.urls).toContain("http://localhost:9527/*");
    expect(capability.remote?.urls).toEqual(defaults.remote?.urls);
  });

  it("keeps the built-in WebView2/Tauri zoom hotkeys disabled", () => {
    const conf = readJson<{ app?: { zoomHotkeysEnabled?: boolean } }>(confPath);
    expect(conf.app?.zoomHotkeysEnabled).not.toBe(true);
  });
});

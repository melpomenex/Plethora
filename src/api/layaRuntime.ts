import { invokeCommand, isTauri } from "../lib/tauri";

export interface LayaServerStatus {
  phase: "stopped" | "preparing-model" | "installing-runtime" | "starting" | "running" | "error";
  running: boolean;
  managed: boolean;
  endpoint: string;
  detail: string | null;
}

const stopped: LayaServerStatus = {
  phase: "stopped",
  running: false,
  managed: false,
  endpoint: "http://127.0.0.1:8000",
  detail: null,
};

export function getLayaServerStatus(): Promise<LayaServerStatus> {
  if (!isTauri()) return Promise.resolve(stopped);
  return invokeCommand<LayaServerStatus>("laya_server_status");
}

export function startLayaServer(): Promise<LayaServerStatus> {
  if (!isTauri()) return Promise.reject(new Error("The local Laya server requires the desktop app."));
  return invokeCommand<LayaServerStatus>("laya_server_start");
}

export function stopLayaServer(): Promise<LayaServerStatus> {
  if (!isTauri()) return Promise.reject(new Error("The local Laya server requires the desktop app."));
  return invokeCommand<LayaServerStatus>("laya_server_stop");
}

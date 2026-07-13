export interface DeviceCapability {
  deviceId: string;
  schemaVersion: number;
  supportsShards: boolean;
  lastSeenAt: string;
}

export function canStopLegacyWrites(devices: DeviceCapability[], requiredSchemaVersion: number): boolean {
  return devices.length > 0 && devices.every((device) => device.supportsShards && device.schemaVersion >= requiredSchemaVersion);
}

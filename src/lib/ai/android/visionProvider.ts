import { OnDeviceAiError } from "../onDeviceAI";
import { unavailableDescriptor } from "../capabilities/types";
import type { PlatformCapabilityDescriptor } from "../capabilities/types";
import type { ScanDocumentRequest, ScanImport, VisionScanProvider } from "../capabilities/vision";
import { invokeAndroidPlugin, isAndroidAiPluginPlatform } from "./bridge";

const PLUGIN = "plethora-android-vision";

export class AndroidVisionScanProvider implements VisionScanProvider {
  readonly id = "android-document-scanner";

  async getCapability(): Promise<PlatformCapabilityDescriptor> {
    if (!isAndroidAiPluginPlatform()) {
      return unavailableDescriptor("vision.scan", "platform_unsupported");
    }
    try {
      return await invokeAndroidPlugin<PlatformCapabilityDescriptor>(PLUGIN, "scan_status");
    } catch {
      return unavailableDescriptor("vision.scan", "platform_unsupported");
    }
  }

  async scanDocument(req: ScanDocumentRequest = {}): Promise<ScanImport> {
    return invokeAndroidPlugin<ScanImport>(PLUGIN, "scan_document", { request: req });
  }
}

export async function runScanDocument(): Promise<ScanImport> {
  const provider = new AndroidVisionScanProvider();
  const cap = await provider.getCapability();
  if (!cap.available) {
    throw new OnDeviceAiError(cap.reason === "permission_denied" ? "permission_denied" : "platform_unsupported", cap.reason ?? "Scan is unavailable.");
  }
  return provider.scanDocument();
}

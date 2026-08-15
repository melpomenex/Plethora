import { invokeCommand } from "../lib/tauri";

export interface ImageAsset {
  id: string;
  mime_type: string;
  file_name?: string;
  byte_size: number;
  sha256: string;
  width?: number;
  height?: number;
  created_at: string;
  reference_count?: number;
  is_referenced?: boolean;
  data_url: string;
}

export interface DeleteImageAssetResult {
  deleted: boolean;
  reason?: string;
}

export async function listImageAssets(): Promise<ImageAsset[]> {
  return invokeCommand<ImageAsset[]>("list_image_assets");
}

export async function getImageAssetById(assetId: string): Promise<ImageAsset | null> {
  return invokeCommand<ImageAsset | null>("get_image_asset", { assetId });
}

export async function deleteImageAsset(assetId: string): Promise<DeleteImageAssetResult> {
  return invokeCommand<DeleteImageAssetResult>("delete_image_asset", { assetId });
}

/**
 * Rename an asset's display name. Cards and extracts reference assets by id,
 * so renaming never breaks an existing reference.
 */
export async function renameImageAsset(assetId: string, fileName: string): Promise<ImageAsset> {
  return invokeCommand<ImageAsset>("rename_image_asset", { assetId, fileName });
}

export async function ingestImageFile(file: File): Promise<ImageAsset> {
  const base64 = await fileToBase64(file);
  return invokeCommand<ImageAsset>("ingest_image_asset", {
    base64Data: base64,
    mimeType: file.type || undefined,
    fileName: file.name || undefined,
  });
}

export async function ingestImageBlob(blob: Blob, fileName?: string): Promise<ImageAsset> {
  const base64 = await blobToBase64(blob);
  return invokeCommand<ImageAsset>("ingest_image_asset", {
    base64Data: base64,
    mimeType: blob.type || undefined,
    fileName,
  });
}

export async function ingestRemoteImage(
  imageUrl: string,
  fileName?: string,
  referrerUrl?: string,
): Promise<ImageAsset> {
  return invokeCommand<ImageAsset>("ingest_remote_image_asset", {
    imageUrl,
    fileName,
    referrerUrl,
  });
}

/**
 * Ingest an image already on disk — e.g. one the viewer displays through the
 * loopback media/epub server. The read happens in Rust, so the webview's
 * cross-origin restrictions (and the SSRF guard that blocks reqwest from
 * fetching our own loopback URLs) never apply.
 */
export async function ingestImageFromPath(
  filePath: string,
  fileName?: string,
  mimeType?: string,
): Promise<ImageAsset> {
  return invokeCommand<ImageAsset>("ingest_image_asset_from_path", {
    filePath,
    fileName,
    mimeType,
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read file"));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read image blob"));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read image blob"));
    reader.readAsDataURL(blob);
  });
}

function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  if (idx === -1) return dataUrl;
  return dataUrl.slice(idx + 1);
}

export interface CompressRequest {
  id: number;
  dataUrl: string;
  maxDimension: number;
  quality: number;
}

export interface CompressResponse {
  id: number;
  success: boolean;
  dataUrl?: string;
  blob?: Blob;
  error?: string;
}

self.onmessage = async (e: MessageEvent<CompressRequest>) => {
  const { id, dataUrl, maxDimension, quality } = e.data;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    let { width, height } = bitmap;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Failed to get OffscreenCanvas context');

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrlOut = reader.result as string;
      (self as unknown as Worker).postMessage({ id, success: true, dataUrl: dataUrlOut, blob: outBlob } as CompressResponse);
    };
    reader.onerror = () => {
      (self as unknown as Worker).postMessage({ id, success: false, error: 'FileReader failed' } as CompressResponse);
    };
    reader.readAsDataURL(outBlob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ id, success: false, error: msg } as CompressResponse);
  }
};

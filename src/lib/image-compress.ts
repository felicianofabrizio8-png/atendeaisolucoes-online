// Client-side image compression tuned for WhatsApp Cloud API delivery.
// Targets: max dim 1600px, JPEG quality auto-tuned to stay <= ~900KB.

export type CompressOptions = {
  maxDimension?: number; // longest side in px
  maxBytes?: number; // hard ceiling
  mimeType?: "image/jpeg" | "image/webp";
};

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 1600,
  maxBytes: 900 * 1024, // ~0.9 MB — safe for WhatsApp + fast upload
  mimeType: "image/jpeg",
};

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const o = { ...DEFAULTS, ...opts };

  // Skip compression for tiny files already under the ceiling
  if (file.size <= o.maxBytes && !needsResize(file)) {
    return file;
  }

  const bitmap = await loadBitmap(file);
  const { width, height } = scaleDims(bitmap.width, bitmap.height, o.maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  // Iterate quality down until file <= maxBytes
  let quality = 0.85;
  let blob: Blob | null = null;
  for (let i = 0; i < 5; i++) {
    blob = await canvasToBlob(canvas, o.mimeType, quality);
    if (!blob) break;
    if (blob.size <= o.maxBytes) break;
    quality -= 0.15;
    if (quality < 0.4) break;
  }
  if (!blob) return file;

  const ext = o.mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.${ext}`, { type: blob.type, lastModified: Date.now() });
}

function needsResize(_file: File) {
  // We can't know dimensions cheaply without decoding, so allow resize attempt
  // for anything larger than a small threshold.
  return _file.size > 300 * 1024;
}

function scaleDims(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  return await loadImageElement(file);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

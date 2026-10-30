import exifr from "exifr";

export type PreparedPreview = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  maxEdge: number;
  quality: number;
};

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function createPreview(file: File): Promise<PreparedPreview> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const maxEdge = 2048;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });

  if (!context) {
    bitmap.close();
    throw new Error("当前浏览器无法创建图片预览");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.8);
  });
  let mimeType = "image/webp";
  let quality = 0.8;

  if (!blob || blob.type !== "image/webp") {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    });
    mimeType = "image/jpeg";
    quality = 0.85;
  }

  if (!blob) throw new Error("无法生成图片预览");

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType,
    width,
    height,
    maxEdge,
    quality,
  };
}

export async function extractCaptureTime(file: File): Promise<Date> {
  try {
    const parsed = (await exifr.parse(file, [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
    ])) as Record<string, unknown> | undefined;
    const candidate = parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate;

    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate;
    }
  } catch {
    // EXIF is optional; fall back to the browser-provided file timestamp.
  }

  return new Date(file.lastModified);
}

export function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Shrinks a photo before it is stored.
 *
 * Receipts live inline in the event log, and that log syncs as a file. A single
 * untouched phone photo can be several megabytes, which would dominate the
 * whole log and make every sync slow. A receipt only has to be legible, so it
 * is capped on the long edge and re-encoded as JPEG.
 */
export async function shrinkImage(file: File, maxEdge = 1400, quality = 0.72): Promise<{ dataUrl: string; bytes: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process the photo.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  // A data URL is base64, so the stored size is about 3/4 of its length.
  const bytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  return { dataUrl, bytes };
}

export const readableSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

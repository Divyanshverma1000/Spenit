/**
 * Shrink a photo in the browser before uploading it.
 *
 * A phone camera photo is often 4-10 MB. Receipt text stays perfectly readable at
 * 1600px on the long edge as a JPEG, which is usually well under 400 KB: far faster on a
 * weak mobile connection, and safely below the server's request size limit.
 *
 * Falls back to the original file if the browser can't decode or re-encode it.
 */
export async function fileToCompressedDataUrl(
  file: File,
  maxEdge = 1600,
  quality = 0.8
): Promise<string> {
  const original = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original();
    ctx.fillStyle = "#fff"; // flatten transparency (PNG screenshots) onto white for JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const out = canvas.toDataURL("image/jpeg", quality);
    // Never make it bigger than the original data URL.
    const orig = await original();
    return out.length < orig.length ? out : orig;
  } catch {
    return original();
  }
}

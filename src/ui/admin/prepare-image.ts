"use client";

const decodeError = "No se pudo leer la imagen. Usa una foto JPG, PNG o WebP.";

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(decodeError);
  }

  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(decodeError);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const webp = await canvasBlob(canvas, "image/webp", 0.82);
    if (webp?.type === "image/webp") return webp;
    const jpeg = await canvasBlob(canvas, "image/jpeg", 0.85);
    if (!jpeg) throw new Error(decodeError);
    return jpeg;
  } finally {
    bitmap.close();
  }
}

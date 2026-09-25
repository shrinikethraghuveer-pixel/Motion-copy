export type ProfileImageKind = "avatar" | "banner";
export type ImageCropArea = { x: number; y: number; width: number; height: number };

const IMAGE_SPECS: Record<ProfileImageKind, { width: number; height: number; maxBytes: number }> = {
  avatar: { width: 400, height: 400, maxBytes: 150 * 1024 },
  banner: { width: 1200, height: 400, maxBytes: 400 * 1024 },
};

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not compress the selected image.")),
      type,
      quality
    );
  });
}

/** Center-crops, resizes, and compresses profile images before Storage upload. */
export async function prepareProfileImage(file: File, kind: ProfileImageKind, cropArea?: ImageCropArea): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const spec = IMAGE_SPECS[kind];
  const image = await createImageBitmap(file);
  const targetRatio = spec.width / spec.height;
  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (cropArea && cropArea.width > 0 && cropArea.height > 0) {
    sx = Math.max(0, Math.min(image.width - 1, cropArea.x));
    sy = Math.max(0, Math.min(image.height - 1, cropArea.y));
    sw = Math.min(image.width - sx, cropArea.width);
    sh = Math.min(image.height - sy, cropArea.height);
  } else if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new Error("Could not prepare the image for upload.");
  }
  // JPEG fallback has no alpha; use a clean white matte for transparent PNGs.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sx, sy, sw, sh, 0, 0, spec.width, spec.height);
  image.close();

  let best: Blob | null = null;
  for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44, 0.34, 0.24, 0.16]) {
    const blob = await encodeCanvas(canvas, "image/webp", quality);
    if (blob.type === "image/webp") {
      best = blob;
      if (blob.size <= spec.maxBytes) break;
    }
  }

  // Safari or older browsers may not encode WebP through canvas.
  if (!best || best.type !== "image/webp" || best.size > spec.maxBytes) {
    for (const quality of [0.82, 0.68, 0.54, 0.4, 0.28, 0.18]) {
      const blob = await encodeCanvas(canvas, "image/jpeg", quality);
      if (blob.type === "image/jpeg") {
        best = blob;
        if (blob.size <= spec.maxBytes) break;
      }
    }
  }

  if (!best || best.size > spec.maxBytes) {
    throw new Error(kind === "avatar"
      ? "This image could not be compressed below 150 KB. Try a simpler image."
      : "This banner could not be compressed to a suitable size. Try a simpler image.");
  }

  const extension = best.type === "image/webp" ? "webp" : "jpg";
  return new File([best], `${kind}.${extension}`, {
    type: best.type,
    lastModified: Date.now(),
  });
}

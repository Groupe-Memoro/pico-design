import { createClient } from "@/lib/supabase/client";
import { ALBUMS_BUCKET } from "./types";

/**
 * Côté navigateur : réduit chaque photo AVANT l'envoi (une version
 * d'impression et une vignette pour l'écran), puis la dépose directement dans
 * le stockage par adresse signée. Une photo de téléphone de 8 Mo devient
 * ~1 Mo : l'envoi va plus vite, et le PDF se génère sans lire des centaines
 * de gros fichiers.
 */

// Côté le plus long. Un portrait d'album fait rarement plus de 6 cm de haut
// (≈ 700 px à 300 dpi) ; une photo de page libre peut couvrir la page.
export const PORTRAIT_MAX_PX = 1600;
export const PAGE_PHOTO_MAX_PX = 3400;
const THUMB_MAX_PX = 420;
const CONCURRENCY = 4;

export const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/webp";

async function toJpeg(bitmap: ImageBitmap, maxPx: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  // Fond blanc : un PNG transparent ne doit pas devenir noir en JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Conversion de la photo impossible.");
  return blob;
}

export interface UploadedPhoto {
  file: File;
  photoPath: string | null;
  error?: string;
}

/**
 * Envoie des photos dans l'album. Renvoie, dans le même ordre, le chemin de
 * chaque photo (ou l'erreur qui l'a empêchée), sans s'arrêter à la première.
 */
export async function uploadAlbumPhotos(
  albumId: string,
  files: File[],
  maxPx: number,
  onProgress?: (done: number, total: number) => void
): Promise<UploadedPhoto[]> {
  const results: UploadedPhoto[] = files.map((file) => ({ file, photoPath: null }));
  const storage = createClient().storage.from(ALBUMS_BUCKET);
  let done = 0;

  // Adresses par lots de 100 (plafond de la route).
  for (let start = 0; start < files.length; start += 100) {
    const batch = files.slice(start, start + 100);
    const res = await fetch(`/api/albums/${albumId}/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: batch.length }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Préparation de l'envoi impossible.");
    const uploads: { photoPath: string; photoToken: string; thumbPath: string; thumbToken: string }[] = data.uploads;

    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (next < batch.length) {
          const i = next++;
          const file = batch[i];
          const target = uploads[i];
          try {
            const bitmap = await createImageBitmap(file);
            const [print, thumb] = await Promise.all([toJpeg(bitmap, maxPx, 0.9), toJpeg(bitmap, THUMB_MAX_PX, 0.8)]);
            bitmap.close();
            const [a, b] = await Promise.all([
              storage.uploadToSignedUrl(target.photoPath, target.photoToken, print, { contentType: "image/jpeg" }),
              storage.uploadToSignedUrl(target.thumbPath, target.thumbToken, thumb, { contentType: "image/jpeg" }),
            ]);
            if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);
            results[start + i].photoPath = target.photoPath;
          } catch (err) {
            results[start + i].error = err instanceof Error ? err.message : "Envoi impossible.";
          }
          onProgress?.(++done, files.length);
        }
      })
    );
  }
  return results;
}

import { createClient } from "@/lib/supabase/client";

/**
 * Côté navigateur, pour les modules multipages (Albums, Agendas) : réduit
 * chaque photo AVANT l'envoi (une version
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

// Où demander les adresses d'envoi (la route « uploads » du document), et
// dans quel bucket elles mènent.
export interface UploadTarget {
  endpoint: string;
  bucket: string;
}

/**
 * Envoie des photos. Renvoie, dans le même ordre, le chemin de chaque photo
 * (ou l'erreur qui l'a empêchée), sans s'arrêter à la première.
 */
export async function uploadPhotos(
  target: UploadTarget,
  files: File[],
  maxPx: number,
  onProgress?: (done: number, total: number) => void
): Promise<UploadedPhoto[]> {
  const results: UploadedPhoto[] = files.map((file) => ({ file, photoPath: null }));
  const storage = createClient().storage.from(target.bucket);
  let done = 0;

  // Adresses par lots de 100 (plafond de la route).
  for (let start = 0; start < files.length; start += 100) {
    const batch = files.slice(start, start + 100);
    const res = await fetch(target.endpoint, {
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
          const slot = uploads[i];
          try {
            const bitmap = await createImageBitmap(file);
            const [print, thumb] = await Promise.all([toJpeg(bitmap, maxPx, 0.9), toJpeg(bitmap, THUMB_MAX_PX, 0.8)]);
            bitmap.close();
            const [a, b] = await Promise.all([
              storage.uploadToSignedUrl(slot.photoPath, slot.photoToken, print, { contentType: "image/jpeg" }),
              storage.uploadToSignedUrl(slot.thumbPath, slot.thumbToken, thumb, { contentType: "image/jpeg" }),
            ]);
            if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);
            results[start + i].photoPath = slot.photoPath;
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

/**
 * Envoie un PDF tel quel (pages fournies par l'école) et renvoie son chemin et
 * son nombre de pages, lu dans le navigateur.
 */
export async function uploadPdf(target: UploadTarget, file: File): Promise<{ path: string; pageCount: number }> {
  const { PDFDocument } = await import("pdf-lib");
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPageCount();
  } catch {
    throw new Error(`« ${file.name} » n'est pas un PDF lisible.`);
  }
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: 1, kind: "pdf" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Préparation de l'envoi impossible.");
  const { path, token } = data.pdf as { path: string; token: string };
  const { error } = await createClient()
    .storage.from(target.bucket)
    .uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
  if (error) throw new Error(`Envoi de « ${file.name} » impossible : ${error.message}`);
  return { path, pageCount };
}

import { uploadPhotos, type UploadedPhoto } from "@/lib/print/upload";
import { ALBUMS_BUCKET } from "./types";

export { ACCEPTED_PHOTO_TYPES, PAGE_PHOTO_MAX_PX, PORTRAIT_MAX_PX } from "@/lib/print/upload";

// Photos d'un album : envoyées dans son dossier du bucket « albums ».
export function uploadAlbumPhotos(
  albumId: string,
  files: File[],
  maxPx: number,
  onProgress?: (done: number, total: number) => void
): Promise<UploadedPhoto[]> {
  return uploadPhotos({ endpoint: `/api/albums/${albumId}/uploads`, bucket: ALBUMS_BUCKET }, files, maxPx, onProgress);
}

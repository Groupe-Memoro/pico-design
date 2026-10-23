// Photos des élèves, dans le navigateur : ZIP ouverts, photos jumelées aux
// lignes du CSV, puis allégées avant l'envoi au rendu. Les photos ne quittent
// le poste que le temps du rendu ; elles ne sont jamais enregistrées.

import { unzip } from "fflate";
import { columnValue, looseKey } from "./types";

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp)$/i;

// Clé de jumelage d'un nom de fichier ou d'une valeur du CSV : sans dossier,
// sans extension d'image, sans accents ni casse.
export function photoKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return looseKey(base.replace(IMAGE_EXTENSIONS, ""));
}

// Variante sans zéros de tête : Excel retire ceux des numéros (« 001234 »
// devient « 1234 ») — l'un ou l'autre côté peut les avoir perdus.
function numericKey(key: string): string | null {
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : null;
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => unzip(bytes, (err, files) => (err ? reject(err) : resolve(files))));
}

/**
 * Les images de fichiers déposés, ZIP compris (ouverts, dossiers inclus).
 * Les fichiers cachés de macOS (__MACOSX, ._photo.jpg) sont ignorés.
 */
export async function collectPhotos(files: File[]): Promise<File[]> {
  const photos: File[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
      for (const [path, bytes] of Object.entries(entries)) {
        const base = path.split("/").pop() ?? path;
        if (!IMAGE_EXTENSIONS.test(base) || path.startsWith("__MACOSX/") || base.startsWith("._")) continue;
        photos.push(new File([new Uint8Array(bytes)], base));
      }
    } else if (IMAGE_EXTENSIONS.test(file.name) || file.type.startsWith("image/")) {
      photos.push(file);
    }
  }
  return photos;
}

export class PhotoIndex {
  private byKey = new Map<string, File>();
  private byNumber = new Map<string, File>();

  constructor(photos: File[]) {
    for (const photo of photos) this.add(photo);
  }

  add(photo: File) {
    const key = photoKey(photo.name);
    this.byKey.set(key, photo);
    const n = numericKey(key);
    if (n) this.byNumber.set(n, photo);
  }

  get size() {
    return this.byKey.size;
  }

  // La photo d'une ligne, d'après la valeur de sa colonne photo.
  find(row: Record<string, string>, column: string | null): File | null {
    if (!column) return null;
    const value = columnValue(row, column);
    if (!value.trim()) return null;
    const key = photoKey(value);
    const direct = this.byKey.get(key);
    if (direct) return direct;
    const n = numericKey(key);
    return n ? this.byNumber.get(n) ?? null : null;
  }
}

// Plus grand côté envoyé au rendu : une photo de carte fait ~2,5 cm, imprimée
// à 400 ppp elle en demande ~400 px ; la marge laisse recadrer.
const MAX_SIDE_PX = 900;

/**
 * La photo allégée en JPEG (orientation de l'appareil appliquée) : une photo
 * de téléphone de 4 Mo en fait ~100 Ko, et un lot de cartes tient alors
 * dans une requête.
 */
export async function shrinkPhoto(photo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canevas indisponible.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Photo illisible."))), "image/jpeg", 0.88)
  );
}

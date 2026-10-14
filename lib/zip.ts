/**
 * Lecture d'une archive zip dans le navigateur, sans bibliothèque : le
 * répertoire central donne chaque fichier, et DecompressionStream
 * (« deflate-raw ») le décompresse. Assez pour les archives courantes
 * (photos, fichiers Excel) ; pas de zip64 ni de chiffrement.
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function entries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archive zip illisible.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const list: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    list.push({
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      localOffset: view.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return list;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`Compression non prise en charge pour « ${entry.name} ».`);
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Le texte d'un fichier de l'archive, ou null s'il n'y est pas. */
export async function readZipText(bytes: Uint8Array, name: string): Promise<string | null> {
  const entry = entries(bytes).find((e) => e.name === name);
  return entry ? new TextDecoder().decode(await readEntry(bytes, entry)) : null;
}

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Les images d'une archive (JPEG, PNG, WebP), dossiers compris, en ignorant
 * les fichiers cachés et les métadonnées de macOS (__MACOSX, ._fichier).
 */
export async function imagesFromZip(file: File): Promise<File[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const images: File[] = [];
  for (const entry of entries(bytes)) {
    const base = entry.name.split("/").pop() ?? "";
    const ext = base.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_TYPES[ext] || entry.name.startsWith("__MACOSX/") || base.startsWith(".")) continue;
    const data = await readEntry(bytes, entry);
    images.push(new File([new Uint8Array(data)], base, { type: IMAGE_TYPES[ext] }));
  }
  return images;
}

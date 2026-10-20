import sharp from "sharp";
import { isPdfBuffer, rasterizePdfPage } from "./pdf/rasterizePdf";

export const ALLOWED_VISUAL_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "application/pdf"];

export interface PreparedFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

/**
 * Prépare un fichier uploadé (visuel de la banque, ou image de produit)
 * pour le stockage : un PDF est converti en PNG (page demandée, la première
 * par défaut, 300 dpi) — le reste de l'app (recadrage, mosaïque, composition)
 * ne traite jamais de PDF directement, seulement des images matricielles ou
 * du SVG.
 */
export async function prepareUploadedFile(file: File, pdfPage = 1): Promise<PreparedFile> {
  const rawBuffer = Buffer.from(await file.arrayBuffer());
  if (file.type === "application/pdf" || isPdfBuffer(rawBuffer)) {
    const buffer = await rasterizePdfPage(rawBuffer, pdfPage);
    // JPEG quand la page n'était qu'une photo (reprise telle quelle), PNG sinon.
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const filename = `${file.name.replace(/\.pdf$/i, "")}.${jpeg ? "jpg" : "png"}`;
    return { buffer, contentType: jpeg ? "image/jpeg" : "image/png", filename };
  }
  // Photo de téléphone : l'orientation est souvent une simple étiquette EXIF,
  // que le navigateur respecte à l'écran. Sans la redresser ici, le recadrage
  // (et donc l'impression) se ferait sur l'image couchée.
  const meta = await sharp(rawBuffer).metadata().catch(() => null);
  if (meta?.orientation && meta.orientation > 1) {
    const upright = sharp(rawBuffer).rotate();
    const buffer = meta.format === "png" ? await upright.png().toBuffer() : await upright.jpeg({ quality: 95 }).toBuffer();
    return { buffer, contentType: meta.format === "png" ? "image/png" : "image/jpeg", filename: file.name };
  }
  return { buffer: rawBuffer, contentType: file.type, filename: file.name };
}

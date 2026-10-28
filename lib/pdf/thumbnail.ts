import sharp from "sharp";
import { pdfToPng } from "pdf-to-png-converter";
import { extractSingleImagePage } from "@/lib/pdf/rasterizePdf";

// Largeur (px) des miniatures : assez pour reconnaître le visuel dans l'aperçu
// de la feuille, assez peu pour rester légères (quelques dizaines de ko).
const THUMBNAIL_WIDTH_PX = 480;

/**
 * Miniature JPEG de la première page d'un PDF (le recto), sur fond blanc.
 */
export async function pdfThumbnailJpeg(pdf: Buffer): Promise<Buffer> {
  // Voie rapide : une page faite d'une seule image (le cas des PDF d'impression)
  // se lit sans rendu pdf.js, bien plus lent sur les grands formats.
  const direct = await extractSingleImagePage(pdf, 1).catch(() => null);
  let source = direct;
  if (!source) {
    const [page] = await pdfToPng(pdf, { pagesToProcess: [1], viewportScale: 1.5 });
    if (!page?.content) throw new Error("Impossible de lire ce PDF.");
    source = page.content;
  }
  return sharp(source)
    .flatten({ background: "#ffffff" })
    .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

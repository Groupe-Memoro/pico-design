// Pages, format et fond perdu d'un document de plusieurs pages, lus dans son
// PDF. Partagé entre l'écran (PDF déposé) et la route qui lit le PDF d'un
// produit. pdf-lib est chargé à la demande (il pèse lourd côté navigateur).

import { MM_TO_PT } from "../pdf/units";

export interface DocumentInfo {
  pageCount: number;
  // Taille de la page 1, fond perdu compris.
  widthMm: number;
  heightMm: number;
  // Pages de formats différents (refusé à l'imposition).
  mixed: boolean;
  // Fond perdu par côté, déduit de la TrimBox de la page 1 ; null si le PDF
  // n'en déclare pas (format fini = page entière, ou PDF sans boîtes).
  bleedMm: number | null;
}

export async function readDocumentInfo(bytes: ArrayBuffer | Uint8Array): Promise<DocumentInfo> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("Ce PDF ne contient aucune page.");
  const first = pages[0].getSize();
  const w = first.width / MM_TO_PT;
  const h = first.height / MM_TO_PT;
  const mixed = pages.some((p) => {
    const sz = p.getSize();
    return Math.abs(sz.width / MM_TO_PT - w) > 0.5 || Math.abs(sz.height / MM_TO_PT - h) > 0.5;
  });
  // Fond perdu : l'écart entre la page et la TrimBox, s'il est le même (à
  // 0,2 mm près) des quatre côtés. pdf-lib rend la page entière sans TrimBox.
  const media = pages[0].getMediaBox();
  const trim = pages[0].getTrimBox();
  const sides = [
    trim.x - media.x,
    trim.y - media.y,
    media.x + media.width - (trim.x + trim.width),
    media.y + media.height - (trim.y + trim.height),
  ].map((pt) => pt / MM_TO_PT);
  const even = Math.max(...sides) - Math.min(...sides) <= 0.2;
  const bleed = Math.round((sides.reduce((a, b) => a + b, 0) / 4) * 100) / 100;
  return { pageCount: pages.length, widthMm: w, heightMm: h, mixed, bleedMm: even && bleed > 0 ? bleed : null };
}

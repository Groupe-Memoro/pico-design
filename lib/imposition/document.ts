// Rendu PDF de l'imposition d'un document de plusieurs pages (voir
// documentPlan.ts pour le plan et l'ordre « couper et empiler »).

import { PDFDocument, cmyk, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";
import { MM_TO_PT, mmToPt } from "../pdf/units";
import { cutLines, flipAxisIsVertical, mirrorCell, type Cell, type FlipEdge } from "./layout";
import { backRotationFor, drawPiece, type Rotation } from "./render";
import { leafAt, planDocument, type DocumentPlan } from "./documentPlan";

export interface DocumentImposeInput {
  name: string;
  pdf: Uint8Array;
  sheetWidth: number;
  sheetHeight: number;
  marginMm: number;
  gutterMm: number;
  // Fond perdu par côté, compris dans les pages du PDF : les traits de coupe
  // tombent à cette distance du bord de chaque page.
  bleedMm: number;
  duplex: boolean;
  flip: FlipEdge;
  copies: number;
  // Ordre « assemblé » : un exemplaire, à imprimer plusieurs fois.
  collated?: boolean;
  // Chaque page est un carton à part (données variables).
  eachPage?: boolean;
  cropMarks: boolean;
}

export interface DocumentImposeResult {
  pdf: Buffer;
  plan: DocumentPlan;
  pageCount: number;
}

// Écart toléré entre les tailles de pages du document (arrondis des logiciels).
const PAGE_TOLERANCE_MM = 0.5;

// Traits de coupe : à 2 mm de la page, 5 mm de long au plus (moins si la marge
// est étroite), en noir 100 % (K seul).
const MARK_GAP_MM = 2;
const MARK_LENGTH_MM = 5;
const MARK_WIDTH_PT = 0.3;

function mm(pt: number): number {
  return pt / MM_TO_PT;
}

function fmt(value: number): string {
  return `${Math.round(value * 10) / 10} mm`;
}

// Traits de coupe dans la marge, alignés sur chaque coupe de la grille (bord
// de chaque page finie). Rien n'est tracé là où la marge est trop étroite.
function drawCropMarks(page: PDFPage, cells: Cell[], layoutCuts: { xs: number[]; ys: number[] }, sheetW: number, sheetH: number) {
  const top = Math.min(...cells.map((c) => c.y));
  const bottom = Math.max(...cells.map((c) => c.y + c.height));
  const left = Math.min(...cells.map((c) => c.x));
  const right = Math.max(...cells.map((c) => c.x + c.width));
  const color = cmyk(0, 0, 0, 1);
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({
      start: { x: mmToPt(x1), y: mmToPt(sheetH - y1) },
      end: { x: mmToPt(x2), y: mmToPt(sheetH - y2) },
      thickness: MARK_WIDTH_PT,
      color,
    });
  const room = (space: number) => Math.min(MARK_LENGTH_MM, space - MARK_GAP_MM);

  const upLen = room(top);
  const downLen = room(sheetH - bottom);
  for (const x of layoutCuts.xs) {
    if (upLen > 1) line(x, top - MARK_GAP_MM - upLen, x, top - MARK_GAP_MM);
    if (downLen > 1) line(x, bottom + MARK_GAP_MM, x, bottom + MARK_GAP_MM + downLen);
  }
  const leftLen = room(left);
  const rightLen = room(sheetW - right);
  for (const y of layoutCuts.ys) {
    if (leftLen > 1) line(left - MARK_GAP_MM - leftLen, y, left - MARK_GAP_MM, y);
    if (rightLen > 1) line(right + MARK_GAP_MM, y, right + MARK_GAP_MM + rightLen, y);
  }
}

export async function imposeDocumentToPdf(input: DocumentImposeInput): Promise<DocumentImposeResult> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input.pdf);
  } catch {
    throw new Error(`« ${input.name} » n'est pas un PDF lisible.`);
  }
  const pages = source.getPages();
  if (pages.length === 0) throw new Error(`« ${input.name} » ne contient aucune page.`);

  // Toutes les pages au même format : la grille est calculée pour UNE taille.
  const { width, height } = pages[0].getSize();
  const pageW = mm(width);
  const pageH = mm(height);
  pages.forEach((p, i) => {
    if (p.getRotation().angle % 360 !== 0) {
      throw new Error(`La page ${i + 1} de « ${input.name} » est pivotée (attribut de rotation) : ré-exportez le PDF sans rotation de page.`);
    }
    const s = p.getSize();
    if (Math.abs(mm(s.width) - pageW) > PAGE_TOLERANCE_MM || Math.abs(mm(s.height) - pageH) > PAGE_TOLERANCE_MM) {
      throw new Error(
        `La page ${i + 1} de « ${input.name} » mesure ${fmt(mm(s.width))} × ${fmt(mm(s.height))}, ` +
          `la page 1 ${fmt(pageW)} × ${fmt(pageH)} : toutes les pages doivent avoir le même format.`
      );
    }
  });

  const plan = planDocument({
    sheetWidth: input.sheetWidth,
    sheetHeight: input.sheetHeight,
    marginMm: input.marginMm,
    gutterMm: input.gutterMm,
    pageWidth: pageW,
    pageHeight: pageH,
    pageCount: pages.length,
    duplex: input.duplex,
    copies: input.copies,
    collated: input.collated,
    eachPage: input.eachPage,
  });
  if (plan.perSheet === 0) {
    throw new Error(
      `Une page (${fmt(pageW)} × ${fmt(pageH)}) ne tient pas sur cette feuille avec ces marges : choisissez une feuille plus grande ou réduisez la marge.`
    );
  }

  const out = await PDFDocument.create();
  // Chaque page du document est intégrée UNE fois, puis dessinée autant de
  // fois qu'il y a d'exemplaires : le fichier reste léger.
  const embedded: PDFEmbeddedPage[] = await out.embedPdf(source, pages.map((_, i) => i));

  const sheetWPt = mmToPt(input.sheetWidth);
  const sheetHPt = mmToPt(input.sheetHeight);
  const { layout } = plan;
  const cuts = cutLines(layout, input.bleedMm);
  const verticalAxis = flipAxisIsVertical(input.sheetWidth, input.sheetHeight, input.flip);
  // Une page déjà dans le sens de la pose reste droite, sinon un quart de tour.
  const rotation: Rotation =
    Math.abs(pageW - layout.cellWidth) <= PAGE_TOLERANCE_MM && Math.abs(pageH - layout.cellHeight) <= PAGE_TOLERANCE_MM
      ? 0
      : 90;

  for (let sheet = 0; sheet < plan.sheets; sheet++) {
    const front = out.addPage([sheetWPt, sheetHPt]);
    const backs: { cell: Cell; page: number }[] = [];
    layout.cells.forEach((cell, slot) => {
      const leaf = leafAt(plan, sheet, slot, input.duplex, pages.length);
      if (!leaf) return;
      drawPiece(front, embedded[leaf.front], cell, input.sheetHeight, rotation);
      if (leaf.back !== null) backs.push({ cell, page: leaf.back });
    });
    if (input.cropMarks) drawCropMarks(front, layout.cells, cuts, input.sheetWidth, input.sheetHeight);

    if (input.duplex) {
      // Verso : chaque page au dos de son recto, en position miroir selon le
      // bord de retournement. Une feuille sans verso (fin d'un document de pages
      // impaires) garde quand même sa page blanche, pour rester recto-verso.
      const back = out.addPage([sheetWPt, sheetHPt]);
      const backRotation = backRotationFor(rotation, verticalAxis);
      for (const { cell, page } of backs) {
        drawPiece(back, embedded[page], mirrorCell(cell, input.sheetWidth, input.sheetHeight, verticalAxis), input.sheetHeight, backRotation);
      }
    }
  }

  return { pdf: Buffer.from(await out.save()), plan, pageCount: pages.length };
}

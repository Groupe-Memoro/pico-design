import sharp from "sharp";
import { coverCropToBuffer } from "./crop";
import { isPdfBuffer, rasterizePdfPage } from "./rasterizePdf";
import type { ThemeSlotAdjust } from "../types";

/**
 * Compose une mosaïque de plusieurs photos distinctes (par opposition à
 * `composeTiledImage`, qui répète UN seul visuel de la banque en motif) : la
 * page cible est divisée en `cols`×`rows` cellules égales, chaque image est
 * recadrée en "cover" (centrée, sans marge) dans sa propre cellule — comme
 * autant de mini `coverCropToBuffer` côte à côte. Une cellule sans image
 * (`null`) reste blanche, comme un fond absent (voir coverCropToBuffer) :
 * permet de composer une mosaïque partiellement remplie plutôt que d'exiger
 * que toutes les cases soient prises.
 *
 * Les bords des cellules sont arrondis indépendamment (`colEdges`/`rowEdges`,
 * plutôt qu'une largeur/hauteur de cellule fixe multipliée) pour que la
 * dernière colonne/ligne absorbe l'arrondi cumulé et que la mosaïque couvre
 * exactement la cible, sans liseré blanc sur le bord droit/bas.
 *
 * `cellAdjust[i]` : le cadrage choisi par le client pour la case i (position
 * et zoom, même mécanique que les emplacements d'un thème, voir
 * ThemeSlotAdjust). Absent = photo centrée en "cover", comme avant.
 *
 * `edges` : limites des colonnes et des rangées (fractions 0-1 de la page),
 * pour des cases inégales — les volets d'un produit plié (voir panelCells,
 * lib/folds.ts). Absent = cases égales. Une case peut alors recevoir un
 * fichier fini, PDF compris (sa première page).
 */
export async function composeMosaicImage(
  cells: (Buffer | null)[],
  cols: number,
  rows: number,
  targetWidthPx: number,
  targetHeightPx: number,
  cellAdjust: (ThemeSlotAdjust | null | undefined)[] = [],
  edges: { cols: number[]; rows: number[] } | null = null
): Promise<Buffer> {
  const c = edges ? edges.cols.length - 1 : Math.max(1, Math.floor(cols));
  const r = edges ? edges.rows.length - 1 : Math.max(1, Math.floor(rows));
  const colEdges = edges
    ? edges.cols.map((f) => Math.round(f * targetWidthPx))
    : Array.from({ length: c + 1 }, (_, i) => Math.round((i * targetWidthPx) / c));
  const rowEdges = edges
    ? edges.rows.map((f) => Math.round(f * targetHeightPx))
    : Array.from({ length: r + 1 }, (_, i) => Math.round((i * targetHeightPx) / r));

  const composites: { input: Buffer; left: number; top: number }[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      const raw = cells[row * c + col] ?? null;
      const cell = raw && isPdfBuffer(raw) ? await rasterizePdfPage(raw, 1) : raw;
      const cellWidth = colEdges[col + 1] - colEdges[col];
      const cellHeight = rowEdges[row + 1] - rowEdges[row];
      if (!cell || cellWidth <= 0 || cellHeight <= 0) continue;
      const adjust = cellAdjust[row * c + col];
      const cropped = adjust
        ? await coverCropToBuffer(cell, cellWidth, cellHeight, adjust.positionX, adjust.positionY, adjust.scale)
        : await coverCropToBuffer(cell, cellWidth, cellHeight);
      composites.push({ input: cropped, left: colEdges[col], top: rowEdges[row] });
    }
  }

  return sharp({
    create: { width: targetWidthPx, height: targetHeightPx, channels: 3, background: "#ffffff" },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();
}

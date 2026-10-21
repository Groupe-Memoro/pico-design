// Jobs de la Duplo (DC-618) : le fichier « AllJobs » exporté par la machine
// (CSV UTF-16 LE, séparé par des tabulations, un emplacement par job, « NO
// DATA » quand il est libre) est le catalogue des configurations de coupe,
// une par format de feuille et de pièce. On en tire la grille d'imposition :
// les pièces sont placées pile entre les traits de refente et de coupe du job.
// Fonctions pures, partagées entre le navigateur (import, aperçu) et le serveur
// (génération du PDF).
//
// Vocabulaire de la machine : la LARGEUR est la dimension de la feuille du
// côté de la refente (traits « Slit », le long du sens d'alimentation) ; la
// LONGUEUR est celle du sens d'alimentation, où se placent les coupes « Cut ».
// Toutes les positions sont en mm depuis le bord de la feuille, à 0,1 mm près.

import type { Cell, Layout, PieceOrientation } from "./layout";
import type { RegCorner } from "./regmark";

// Position du code-barres et du repère REG sur la feuille. L'outil ne la règle
// pas : c'est celle des feuilles imposées par Fiery pour la Duplo, mesurée sur
// deux d'entre elles (jobs 6 et 241, 12 x 18 po, image à 600 dpi). Les deux sont
// dans le coin haut-droit ; le haut des barres est à 5 mm du haut et leur centre
// à 42,5 mm du bord droit, donc un code-barres de 25 mm de large (PDF des jobs)
// est à 30 mm du bord droit. Le repère REG, lui, prend les distances du job.
export const DUPLO_MARKS = {
  corner: "top-right" as RegCorner,
  barcodeXMm: 30,
  barcodeYMm: 5,
  barcodeRotation: 0 as const,
};

const MAX_SLITS = 6;
const MAX_CUTS = 30;

// Écart toléré (mm) entre la taille de feuille d'un job et celle de la feuille choisie.
const SHEET_TOLERANCE_MM = 1;
// Écart toléré (mm) entre la taille finie d'une pièce et l'intervalle entre
// deux traits du job : les jobs saisis à la main sont arrondis au dixième.
const PIECE_TOLERANCE_MM = 0.5;

export interface DuploJobGeometry {
  widthMm: number;
  lengthMm: number;
  // Positions non nulles, triées : refentes (dans la largeur) et coupes (dans la longueur).
  slits: number[];
  cuts: number[];
}

// Un job tel qu'il est lu dans le fichier, prêt à être enregistré.
export interface ParsedDuploJob extends DuploJobGeometry {
  jobNo: number;
  name: string;
  // Repère REG lu par la machine, et sa distance (mm) aux bords de la feuille.
  regMark: boolean;
  sideMarkMm: number;
  leadMarkMm: number;
}

// -------------------------------------------------------------- Lecture

const parseCell = (cell: string | undefined): number => Number((cell ?? "").replace(/[<>]/g, "")) || 0;

// Lit un fichier AllJobs et retourne les jobs qui ont au moins un trait de
// coupe (les emplacements libres sont ignorés). Lève une Error (message en
// français) si le fichier n'a pas le format attendu.
export function parseAllJobs(bytes: ArrayBuffer): ParsedDuploJob[] {
  const view = new Uint8Array(bytes);
  if (view[0] !== 0xff || view[1] !== 0xfe) {
    throw new Error("Ce fichier n'est pas un export AllJobs de la Duplo (UTF-16 attendu).");
  }
  const lines = new TextDecoder("utf-16le").decode(view.subarray(2)).split(/\r?\n/);
  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const columns = { no: col("JOB No."), name: col("JOB name"), width: col("Width"), length: col("Length") };
  const regColumns = { reg: col("REG mark"), side: col("Side mark"), lead: col("Lead mark") };
  const slitColumns = Array.from({ length: MAX_SLITS }, (_, i) => col(`Slit${i + 1}`));
  const cutColumns = Array.from({ length: MAX_CUTS }, (_, i) => col(`Cut${i + 1}`));
  if (Object.values(columns).includes(-1) || slitColumns.includes(-1) || cutColumns.includes(-1)) {
    throw new Error("Ce fichier n'est pas un export AllJobs de la Duplo (colonnes manquantes).");
  }

  const jobs: ParsedDuploJob[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const jobNo = Number.parseInt(cells[columns.no], 10);
    const rawName = (cells[columns.name] ?? "").trim();
    if (!Number.isInteger(jobNo) || rawName === "NO DATA") continue;
    // Un job peut n'avoir jamais été nommé sur la machine.
    const name = rawName || `Job sans nom (n° ${jobNo})`;
    const positions = (indexes: number[]) =>
      indexes
        .map((i) => parseCell(cells[i]))
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
    const job = {
      jobNo,
      name,
      widthMm: parseCell(cells[columns.width]),
      lengthMm: parseCell(cells[columns.length]),
      slits: positions(slitColumns),
      cuts: positions(cutColumns),
      regMark: (cells[regColumns.reg] ?? "").trim() === "On",
      sideMarkMm: parseCell(cells[regColumns.side]),
      leadMarkMm: parseCell(cells[regColumns.lead]),
    };
    if (job.widthMm > 0 && job.lengthMm > 0 && (job.slits.length > 0 || job.cuts.length > 0)) jobs.push(job);
  }
  if (jobs.length === 0) throw new Error("Ce fichier ne contient aucun job avec des traits de coupe.");
  return jobs;
}

// Valide les jobs reçus par l'API (JSON) : retourne les lignes à enregistrer ou une erreur.
export function validateDuploJobs(body: unknown) {
  const raw = (body as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Aucun job à enregistrer." } as const;
  const isPositions = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
  const rows = [];
  const seen = new Set<number>();
  for (const item of raw as Record<string, unknown>[]) {
    const jobNo = Number(item?.job_no);
    const name = String(item?.name ?? "").trim();
    const width = Number(item?.width_mm);
    const length = Number(item?.length_mm);
    // Repère REG : facultatif (absent = pas de repère).
    const regMark = item?.reg_mark === true;
    const sideMark = item?.side_mark_mm === undefined ? 0 : Number(item.side_mark_mm);
    const leadMark = item?.lead_mark_mm === undefined ? 0 : Number(item.lead_mark_mm);
    if (
      !Number.isFinite(sideMark) ||
      !Number.isFinite(leadMark) ||
      sideMark < 0 ||
      leadMark < 0
    ) {
      return { error: `Le repère REG du job n° ${item?.job_no ?? "?"} est invalide.` } as const;
    }
    if (
      !Number.isInteger(jobNo) ||
      jobNo < 1 ||
      seen.has(jobNo) ||
      !name ||
      !(width > 0) ||
      !(length > 0) ||
      !isPositions(item.slits) ||
      !isPositions(item.cuts) ||
      item.slits.length > MAX_SLITS ||
      item.cuts.length > MAX_CUTS
    ) {
      return { error: `Le job n° ${item?.job_no ?? "?"} est invalide.` } as const;
    }
    seen.add(jobNo);
    rows.push({
      job_no: jobNo,
      name,
      width_mm: width,
      length_mm: length,
      slits: item.slits,
      cuts: item.cuts,
      reg_mark: regMark,
      side_mark_mm: sideMark,
      lead_mark_mm: leadMark,
    });
  }
  return { rows } as const;
}

// --------------------------------------------------------------- Grille

// Intervalles [début, fin] de longueur `size` (±tolérance) entre deux traits
// CONSÉCUTIFS de `edges` (triés), sans chevauchement : une pièce est toujours
// bornée par deux traits voisins, jamais à cheval sur une bande de rebut. Les
// traits qui ne bornent pas une pièce (refilage) sont sautés. Les bords de la
// feuille (0 et `extent`) comptent comme des traits : une feuille coupée en deux
// n'a qu'un seul trait.
function intervals(edges: number[], extent: number, size: number): [number, number][] {
  const all = [0, ...edges.filter((e) => e > 0 && e < extent), extent];
  const result: [number, number][] = [];
  for (let i = 0; i < all.length - 1; i++) {
    // Deux pièces voisines peuvent partager un même trait (pas de bande
    // perdue entre elles) : l'intervalle suivant est examiné lui aussi.
    if (Math.abs(all[i + 1] - all[i] - size) <= PIECE_TOLERANCE_MM) result.push([all[i], all[i + 1]]);
  }
  return result;
}

export interface DuploLayoutInput {
  job: DuploJobGeometry;
  sheetWidth: number;
  sheetHeight: number;
  // Taille d'une pièce, fond perdu inclus (= taille de la page du PDF source).
  pieceWidth: number;
  pieceHeight: number;
  // Fond perdu par côté : la taille finie de la pièce en est déduite.
  bleedMm: number;
  orientation: PieceOrientation;
  // Décalage de calibration de la découpeuse (positif = vers la droite / le bas).
  offsetX: number;
  offsetY: number;
}

// Grille d'imposition d'un job : chaque pièce est centrée sur le rectangle que
// délimitent les traits du job. Retourne null si le job ne convient pas (feuille
// d'une autre taille, ou aucune pièce de ce format entre ses traits). La feuille
// peut être posée dans l'un ou l'autre sens dans la machine.
export function computeDuploLayout(input: DuploLayoutInput): Layout | null {
  const { job, sheetWidth, sheetHeight } = input;
  const close = (a: number, b: number) => Math.abs(a - b) <= SHEET_TOLERANCE_MM;
  let xEdges: number[];
  let yEdges: number[];
  if (close(sheetWidth, job.widthMm) && close(sheetHeight, job.lengthMm)) {
    xEdges = job.slits;
    yEdges = job.cuts;
  } else if (close(sheetWidth, job.lengthMm) && close(sheetHeight, job.widthMm)) {
    xEdges = job.cuts;
    yEdges = job.slits;
  } else {
    return null;
  }

  function candidate(rotated: boolean) {
    const cellWidth = rotated ? input.pieceHeight : input.pieceWidth;
    const cellHeight = rotated ? input.pieceWidth : input.pieceHeight;
    const finishedWidth = cellWidth - 2 * input.bleedMm;
    const finishedHeight = cellHeight - 2 * input.bleedMm;
    const cols = finishedWidth > 0 ? intervals(xEdges, sheetWidth, finishedWidth) : [];
    const rows = finishedHeight > 0 ? intervals(yEdges, sheetHeight, finishedHeight) : [];
    return { rotated, cellWidth, cellHeight, cols, rows, count: cols.length * rows.length };
  }

  const normal = candidate(false);
  const turned = candidate(true);
  let chosen = normal;
  if (input.orientation === "rotated") chosen = turned;
  else if (input.orientation === "auto" && turned.count > normal.count) chosen = turned;
  if (chosen.count === 0) return null;

  const { rotated, cellWidth, cellHeight, cols, rows } = chosen;
  const cells: Cell[] = [];
  rows.forEach(([top, bottom], row) => {
    cols.forEach(([left, right], col) => {
      cells.push({
        col,
        row,
        x: (left + right) / 2 - cellWidth / 2 + input.offsetX,
        y: (top + bottom) / 2 - cellHeight / 2 + input.offsetY,
        width: cellWidth,
        height: cellHeight,
      });
    });
  });

  // Zone utile pour l'aperçu : l'étendue de la grille.
  const x0 = Math.min(...cells.map((c) => c.x));
  const y0 = Math.min(...cells.map((c) => c.y));
  const x1 = Math.max(...cells.map((c) => c.x + c.width));
  const y1 = Math.max(...cells.map((c) => c.y + c.height));
  return {
    cols: cols.length,
    rows: rows.length,
    rotated,
    cellWidth,
    cellHeight,
    cells,
    usable: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  };
}

// Morceau de feuille coupé à la 1re passe, en mm sur la feuille.
export interface DuploPiece {
  x: number;
  y: number;
  width: number;
  height: number;
  // Vrai si le morceau entre dans la machine tourné d'un quart de tour par
  // rapport à la feuille (sa largeur sur la feuille est la longueur du 2e job).
  rotated?: boolean;
}

/**
 * Deux passes sur la Duplo (ex. cartes de souhait) : le 1er job coupe la
 * feuille en morceaux de la taille de feuille du 2e job (ex. 12 × 18 → deux
 * 10 × 8), puis chaque morceau repasse avec le 2e job, qui coupe la pièce
 * finale (et la rainure). Les pièces sont placées selon les traits du 2e job,
 * dans chaque morceau. Retourne null si l'un des deux jobs ne convient pas.
 */
export function computeDuploTwoPassLayout(
  input: Omit<DuploLayoutInput, "job"> & { job1: DuploJobGeometry; job2: DuploJobGeometry }
): { layout: Layout; pieces: DuploPiece[] } | null {
  const stage1 = computeDuploLayout({
    job: input.job1,
    sheetWidth: input.sheetWidth,
    sheetHeight: input.sheetHeight,
    pieceWidth: input.job2.widthMm,
    pieceHeight: input.job2.lengthMm,
    bleedMm: 0,
    orientation: "auto",
    offsetX: 0,
    offsetY: 0,
  });
  if (!stage1) return null;
  const cells: Cell[] = [];
  let local: Layout | null = null;
  for (const piece of stage1.cells) {
    local = computeDuploLayout({
      job: input.job2,
      sheetWidth: piece.width,
      sheetHeight: piece.height,
      pieceWidth: input.pieceWidth,
      pieceHeight: input.pieceHeight,
      bleedMm: input.bleedMm,
      orientation: input.orientation,
      offsetX: 0,
      offsetY: 0,
    });
    if (!local) return null;
    for (const c of local.cells) {
      cells.push({
        ...c,
        col: piece.col * local.cols + c.col,
        row: piece.row * local.rows + c.row,
        x: piece.x + c.x + input.offsetX,
        y: piece.y + c.y + input.offsetY,
      });
    }
  }
  if (!local || cells.length === 0) return null;
  const x0 = Math.min(...cells.map((c) => c.x));
  const y0 = Math.min(...cells.map((c) => c.y));
  const x1 = Math.max(...cells.map((c) => c.x + c.width));
  const y1 = Math.max(...cells.map((c) => c.y + c.height));
  return {
    layout: {
      cols: stage1.cols * local.cols,
      rows: stage1.rows * local.rows,
      rotated: local.rotated,
      cellWidth: local.cellWidth,
      cellHeight: local.cellHeight,
      cells,
      usable: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    },
    pieces: stage1.cells.map(({ x, y, width, height }) => ({ x, y, width, height, rotated: stage1.rotated })),
  };
}

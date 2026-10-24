import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  clip,
  cmyk,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFEmbeddedPage,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import { MM_TO_PT, mmToPt } from "../pdf/units";
import {
  assignCells,
  computeLayout,
  flipAxisIsVertical,
  mirrorCell,
  type Cell,
  type FlipEdge,
  type Layout,
  type LayoutInput,
} from "./layout";
import { computeDuploLayout, computeDuploTwoPassLayout, type DuploJobGeometry, type DuploPiece } from "./duplo";
import { regMarkFits, regMarkRects, type RegCorner } from "./regmark";

export interface ImpositionSource {
  name: string;
  pdf: Uint8Array;
  copies: number;
  // Pages du PDF qui font cette pièce (index à partir de 0). Absentes : la
  // page 1 au recto et, s'il y en a une, la page 2 au verso. `backPage: null`
  // = recto seul. Un PDF de plusieurs pages devient ainsi plusieurs pièces
  // (voir expandPages dans build.ts).
  page?: number;
  backPage?: number | null;
  // Verso fourni à part (un fichier de verso joint) : `backPage` est alors une
  // page de ce PDF-ci.
  backPdf?: Uint8Array | null;
}

export type MarksKind = "pdf" | "png" | "jpg";

export interface ImpositionMarks {
  bytes: Uint8Array;
  kind: MarksKind;
}

// Code-barres du job Duplo, posé au recto. Il est ancré au coin `corner` de la
// feuille : `xMm` est la distance entre le bord (gauche ou droit) de ce coin et
// le côté du code-barres qui lui fait face, `yMm` celle du bord haut ou bas.
// `rotation` en degrés antihoraires.
export interface ImpositionBarcode {
  pdf: Uint8Array;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  xMm: number;
  yMm: number;
  rotation: Rotation;
}

// Repère REG du job Duplo : L noir posé au recto, dans le coin `corner`.
export interface ImpositionRegMark {
  corner: RegCorner;
  sideMm: number;
  leadMm: number;
}

export interface ImposeInput extends LayoutInput {
  sources: ImpositionSource[];
  marks: ImpositionMarks | null;
  flip: FlipEdge;
  // Job de la Duplo : si fourni, la grille en est tirée (marges, espacement et
  // centrage du profil sont alors ignorés ; le décalage de calibration reste).
  duploJob?: DuploJobGeometry | null;
  // Fond perdu par côté, pour retrouver la taille finie des pièces d'un job.
  pieceBleedMm?: number;
  barcode?: ImpositionBarcode | null;
  regMark?: ImpositionRegMark | null;
  // 2e passe sur la Duplo (ex. cartes de souhait) : le job qui repasse chaque
  // morceau coupé par le 1er job (voir computeDuploTwoPassLayout), et son
  // code-barres et repère REG, posés en haut de chaque morceau.
  duploJob2?: DuploJobGeometry | null;
  secondPass?: DuploSecondPass | null;
}

export interface DuploSecondPass {
  barcode: ImpositionBarcode | null;
  regMark: ImpositionRegMark | null;
  // Morceau tourné d'un quart de tour pour entrer dans la machine : dans le
  // sens horaire ("cw") ou antihoraire ("ccw"). Sans effet si le morceau
  // garde le sens de la feuille.
  turn?: "cw" | "ccw";
}

// Code-barres et repère d'un morceau qui entre tourné : le coin « haut-droite »
// du 2e job, vu une fois le morceau tourné, ramené sur la feuille. Tourné dans
// le sens horaire, le bord gauche du morceau devient le bord d'attaque.
function turnedMarks(second: DuploSecondPass): Pick<DuploSecondPass, "barcode" | "regMark"> {
  const cw = (second.turn ?? "cw") === "cw";
  const corner = cw ? ("top-left" as const) : ("bottom-right" as const);
  return {
    barcode: second.barcode
      ? {
          ...second.barcode,
          corner,
          xMm: second.barcode.yMm,
          yMm: second.barcode.xMm,
          rotation: (((cw ? 90 : 270) + second.barcode.rotation) % 360) as Rotation,
        }
      : null,
    regMark: second.regMark ? { corner, sideMm: second.regMark.leadMm, leadMm: second.regMark.sideMm } : null,
  };
}

export interface ImposeResult {
  pdf: Buffer;
  layout: Layout;
  placed: number;
  hasBack: boolean;
}

// Écart toléré (mm) entre la taille de page d'un PDF source et celle du
// format choisi : absorbe les arrondis des logiciels de mise en page sans
// laisser passer une pièce qui déborderait sur sa voisine.
const PAGE_SIZE_TOLERANCE_MM = 0.1;

export type Rotation = 0 | 90 | 180 | 270;

interface PreparedSource {
  name: string;
  front: PDFEmbeddedPage;
  back: PDFEmbeddedPage | null;
  // Taille de la page source (mm) : sert à décider si elle entre telle quelle
  // dans une cellule ou s'il faut la tourner de 90°.
  pageWidth: number;
  pageHeight: number;
}

function mm(pt: number): number {
  return pt / MM_TO_PT;
}

function fmtMm(value: number): string {
  return `${Math.round(value * 100) / 100} mm`;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= PAGE_SIZE_TOLERANCE_MM;
}

// PDF sources déjà lus et pages déjà intégrées, pour un même PDF de sortie :
// les pièces tirées d'un même fichier de plusieurs pages ne le relisent pas,
// et une page n'est intégrée qu'une fois, même posée plusieurs fois.
interface SourceCache {
  docs: Map<Uint8Array, PDFDocument>;
  embedded: Map<Uint8Array, Map<number, PDFEmbeddedPage>>;
}

async function prepareSource(
  out: PDFDocument,
  source: ImpositionSource,
  pieceWidth: number,
  pieceHeight: number,
  cache: SourceCache = { docs: new Map(), embedded: new Map() }
): Promise<PreparedSource> {
  const load = async (bytes: Uint8Array, label: string) => {
    let loaded = cache.docs.get(bytes);
    if (!loaded) {
      try {
        loaded = await PDFDocument.load(bytes);
      } catch {
        throw new Error(`${label} n'est pas un PDF lisible.`);
      }
      cache.docs.set(bytes, loaded);
    }
    return loaded;
  };
  const doc = await load(source.pdf, `« ${source.name} »`);
  // Le verso : dans un fichier joint, ou dans le fichier lui-même.
  const backBytes = source.backPdf ?? source.pdf;
  const backDoc = source.backPdf ? await load(source.backPdf, `Le verso de « ${source.name} »`) : doc;
  const all = doc.getPages();
  const allBack = backDoc.getPages();
  const frontIndex = source.page ?? 0;
  const backIndex =
    source.backPage === undefined ? (source.backPdf ? 0 : all.length > 1 ? 1 : null) : source.backPage;
  if (frontIndex >= all.length) throw new Error(`« ${source.name} » n'a pas de page ${frontIndex + 1}.`);
  if (backIndex !== null && backIndex >= allBack.length) {
    throw new Error(`Le verso de « ${source.name} » n'a pas de page ${backIndex + 1}.`);
  }
  const pages = backIndex === null ? [all[frontIndex]] : [all[frontIndex], allBack[backIndex]];
  if (pages.length === 0) throw new Error(`« ${source.name} » ne contient aucune page.`);

  // pdf-lib intègre les pages sans tenir compte de /Rotate : on refuse plutôt
  // que d'imprimer une pièce de travers.
  if (pages.some((p) => p.getRotation().angle % 360 !== 0)) {
    throw new Error(
      `« ${source.name} » contient une page pivotée (attribut de rotation). Ré-exportez le PDF sans rotation de page.`
    );
  }

  const { width, height } = pages[0].getSize();
  const w = mm(width);
  const h = mm(height);
  const fitsAsIs = close(w, pieceWidth) && close(h, pieceHeight);
  const fitsTurned = close(w, pieceHeight) && close(h, pieceWidth);
  if (!fitsAsIs && !fitsTurned) {
    throw new Error(
      `« ${source.name} » mesure ${fmtMm(w)} × ${fmtMm(h)}, mais le format choisi mesure ${fmtMm(
        pieceWidth
      )} × ${fmtMm(pieceHeight)} (fond perdu inclus).`
    );
  }

  if (pages.length > 1) {
    const { width: bw, height: bh } = pages[1].getSize();
    if (!close(mm(bw), w) || !close(mm(bh), h)) {
      throw new Error(`Le verso de « ${source.name} » n'a pas la même taille que son recto.`);
    }
  }

  const embed = async (bytes: Uint8Array, from: PDFDocument, index: number) => {
    let byIndex = cache.embedded.get(bytes);
    if (!byIndex) cache.embedded.set(bytes, (byIndex = new Map()));
    let page = byIndex.get(index);
    if (!page) {
      [page] = await out.embedPdf(from, [index]);
      byIndex.set(index, page);
    }
    return page;
  };
  return {
    name: source.name,
    front: await embed(source.pdf, doc, frontIndex),
    back: backIndex === null ? null : await embed(backBytes, backDoc, backIndex),
    pageWidth: w,
    pageHeight: h,
  };
}

// Dessine `page` à sa taille réelle dans une cellule (coordonnées en points,
// origine en bas à gauche), tournée de `rotation` degrés (sens antihoraire).
// pdf-lib tourne autour du point d'insertion : on le place donc au coin
// de la cellule qui, après rotation, devient son coin bas-gauche.
function drawInCell(
  sheetPage: ReturnType<PDFDocument["addPage"]>,
  page: PDFEmbeddedPage,
  cell: { x: number; y: number; width: number; height: number },
  rotation: Rotation
) {
  let x = cell.x;
  let y = cell.y;
  if (rotation === 90) x = cell.x + cell.width;
  else if (rotation === 180) {
    x = cell.x + cell.width;
    y = cell.y + cell.height;
  } else if (rotation === 270) y = cell.y + cell.height;
  sheetPage.drawPage(page, { x, y, width: page.width, height: page.height, rotate: degrees(rotation) });
}

// Pose une pièce dans sa cellule, rognée à sa zone `clip` s'il y en a une
// (fonds perdus de deux voisines qui se chevauchent, voir computeLayout).
export function drawPiece(
  sheetPage: PDFPage,
  page: PDFEmbeddedPage,
  cell: Cell,
  sheetHeight: number,
  rotation: Rotation
) {
  if (!cell.clip) {
    drawInCell(sheetPage, page, toPdfRect(cell, sheetHeight), rotation);
    return;
  }
  const c = toPdfRect({ ...cell, ...cell.clip }, sheetHeight);
  sheetPage.pushOperators(pushGraphicsState(), rectangle(c.x, c.y, c.width, c.height), clip(), endPath());
  drawInCell(sheetPage, page, toPdfRect(cell, sheetHeight), rotation);
  sheetPage.pushOperators(popGraphicsState());
}

function toPdfRect(cell: Cell, sheetHeight: number) {
  return {
    x: mmToPt(cell.x),
    y: mmToPt(sheetHeight - cell.y - cell.height),
    width: mmToPt(cell.width),
    height: mmToPt(cell.height),
  };
}

// Marge blanche (mm) autour du code-barres : zone de silence exigée par le
// code 39 et fond qui l'isole des pièces, comme sur les feuilles de Fiery
// (fond blanc de 3 à 4 mm autour des barres).
const BARCODE_QUIET_ZONE_MM = 3.5;

// Pose la 1re page du PDF du code-barres à sa taille réelle, dans le coin
// d'ancrage, sur un fond blanc, la boîte obtenue APRÈS rotation devant tenir
// sur la feuille.
async function drawBarcode(
  out: PDFDocument,
  sheetPage: ReturnType<PDFDocument["addPage"]>,
  barcode: ImpositionBarcode,
  sheetWidth: number,
  sheetHeight: number,
  // Rectangle de référence pour le coin d'ancrage (un morceau de la 1re passe) ;
  // absent = la feuille entière.
  frame: DuploPiece = { x: 0, y: 0, width: sheetWidth, height: sheetHeight }
) {
  let embedded: PDFEmbeddedPage;
  try {
    [embedded] = await out.embedPdf(await PDFDocument.load(barcode.pdf), [0]);
  } catch {
    throw new Error("Le PDF du code-barres de ce job est illisible.");
  }
  const turned = barcode.rotation % 180 !== 0;
  const width = mm(turned ? embedded.height : embedded.width);
  const height = mm(turned ? embedded.width : embedded.height);
  const x = frame.x + (barcode.corner.endsWith("right") ? frame.width - barcode.xMm - width : barcode.xMm);
  const y = frame.y + (barcode.corner.startsWith("bottom") ? frame.height - barcode.yMm - height : barcode.yMm);
  if (
    x < -PAGE_SIZE_TOLERANCE_MM ||
    y < -PAGE_SIZE_TOLERANCE_MM ||
    x + width > sheetWidth + PAGE_SIZE_TOLERANCE_MM ||
    y + height > sheetHeight + PAGE_SIZE_TOLERANCE_MM
  ) {
    throw new Error(
      `Le code-barres (${fmtMm(width)} × ${fmtMm(height)}) déborde de la feuille à cette position : ` +
        "ajustez sa position dans le profil de découpeuse."
    );
  }
  // Fond blanc (borné à la feuille), puis le code-barres par-dessus.
  const q = BARCODE_QUIET_ZONE_MM;
  const left = Math.max(0, x - q);
  const top = Math.max(0, y - q);
  const backdrop = toPdfRect(
    {
      col: 0,
      row: 0,
      x: left,
      y: top,
      width: Math.min(sheetWidth, x + width + q) - left,
      height: Math.min(sheetHeight, y + height + q) - top,
    },
    sheetHeight
  );
  sheetPage.drawRectangle({ ...backdrop, color: cmyk(0, 0, 0, 0), borderWidth: 0 });
  drawInCell(
    sheetPage,
    embedded,
    toPdfRect({ col: 0, row: 0, x, y, width, height }, sheetHeight),
    barcode.rotation
  );
  return { x, y, width, height };
}

// Repère REG : deux traits noirs (K seul) formant un L.
function drawRegMark(
  sheetPage: ReturnType<PDFDocument["addPage"]>,
  reg: ImpositionRegMark,
  sheetWidth: number,
  sheetHeight: number,
  frame: DuploPiece = { x: 0, y: 0, width: sheetWidth, height: sheetHeight }
) {
  const rects = regMarkRects(reg.corner, reg.sideMm, reg.leadMm, frame.width, frame.height).map((r) => ({
    ...r,
    x: r.x + frame.x,
    y: r.y + frame.y,
  }));
  if (!regMarkFits(rects, sheetWidth, sheetHeight)) {
    throw new Error(
      `Le repère REG de ce job (à ${fmtMm(reg.sideMm)} × ${fmtMm(reg.leadMm)} du bord) déborde de la feuille.`
    );
  }
  for (const r of rects) {
    sheetPage.drawRectangle({
      ...toPdfRect({ col: 0, row: 0, ...r }, sheetHeight),
      color: cmyk(0, 0, 0, 1),
      borderWidth: 0,
    });
  }
}

// Calques du PDF (groupes de contenu optionnel, visibles dans le panneau des
// calques d'Acrobat ou d'Illustrator). Ils sont créés du plus bas au plus haut :
// le premier calque est dessiné en premier, les suivants passent par-dessus.
interface Layer {
  key: string;
  ref: PDFRef;
}

class Layers {
  private layers: Layer[] = [];

  constructor(private out: PDFDocument) {}

  add(name: string): Layer {
    const ref = this.out.context.register(
      this.out.context.obj({ Type: "OCG", Name: PDFHexString.fromText(name.slice(0, 80)) })
    );
    const layer = { key: `Calque${this.layers.length + 1}`, ref };
    this.layers.push(layer);
    return layer;
  }

  // Déclare les calques dans le catalogue, tous visibles. Le panneau les liste
  // du plus haut au plus bas, comme Illustrator : le premier calque est en bas.
  finish() {
    if (this.layers.length === 0) return;
    const refs = this.layers.map((l) => l.ref);
    this.out.catalog.set(
      PDFName.of("OCProperties"),
      this.out.context.obj({ OCGs: refs, D: { BaseState: "ON", Order: [...refs].reverse(), ON: refs } })
    );
  }
}

// Exécute `draw` (dessin sur `page`) à l'intérieur du calque : le contenu est
// encadré par /OC … BDC … EMC, et le calque est déclaré dans les ressources de la page.
async function inLayer(page: PDFPage, layer: Layer, draw: () => void | Promise<void>) {
  const resources = page.node.normalizedEntries().Resources;
  let properties = resources.lookupMaybe(PDFName.of("Properties"), PDFDict);
  if (!properties) {
    properties = page.doc.context.obj({});
    resources.set(PDFName.of("Properties"), properties);
  }
  properties.set(PDFName.of(layer.key), layer.ref);
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of("OC"), PDFName.of(layer.key)])
  );
  await draw();
  page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
}

async function drawMarks(
  out: PDFDocument,
  sheetPage: ReturnType<PDFDocument["addPage"]>,
  marks: ImpositionMarks,
  sheetWidthPt: number,
  sheetHeightPt: number
) {
  if (marks.kind === "pdf") {
    const [embedded] = await out.embedPdf(await PDFDocument.load(marks.bytes), [0]);
    // Taille réelle, centrée : un fichier de marques de la taille de la
    // feuille tombe pile, un fichier plus petit reste bien centré.
    sheetPage.drawPage(embedded, {
      x: (sheetWidthPt - embedded.width) / 2,
      y: (sheetHeightPt - embedded.height) / 2,
      width: embedded.width,
      height: embedded.height,
    });
    return;
  }
  const image = marks.kind === "png" ? await out.embedPng(marks.bytes) : await out.embedJpg(marks.bytes);
  // Une image n'a pas de taille physique fiable : on la considère comme un
  // calque de la taille de la feuille.
  sheetPage.drawImage(image, { x: 0, y: 0, width: sheetWidthPt, height: sheetHeightPt });
}

// Rotation du verso d'une pièce dont le recto est tourné de `frontRotation`.
// Le verso se tourne comme un feuillet : si l'axe de retournement de la
// feuille n'est pas celui de la pièce (pièce couchée sur la feuille), il doit
// être tourné de 180° de plus pour rester à l'endroit.
export function backRotationFor(frontRotation: Rotation, verticalAxis: boolean): Rotation {
  const pieceAxisVertical = frontRotation % 180 === 0;
  return ((frontRotation + (pieceAxisVertical === verticalAxis ? 0 : 180)) % 360) as Rotation;
}

/**
 * Grille d'une imposition (sans rien dessiner) : celle du job Duplo (une ou
 * deux passes) ou du profil Graphtec, et les morceaux de la 1re passe. Lève
 * une Error (message en français) si le format n'y entre pas.
 */
export function impositionLayout(input: Omit<ImposeInput, "sources" | "marks" | "flip">): {
  layout: Layout;
  duploPieces: DuploPiece[];
} {
  let layout: Layout | null;
  // Morceaux coupés par le 1er job, quand il y a une 2e passe.
  let duploPieces: DuploPiece[] = [];
  if (input.duploJob && input.duploJob2) {
    const twoPass = computeDuploTwoPassLayout({
      job1: input.duploJob,
      job2: input.duploJob2,
      sheetWidth: input.sheetWidth,
      sheetHeight: input.sheetHeight,
      pieceWidth: input.pieceWidth,
      pieceHeight: input.pieceHeight,
      bleedMm: input.pieceBleedMm ?? 0,
      orientation: input.orientation,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
    });
    if (!twoPass) {
      throw new Error(
        "Ces deux jobs Duplo ne vont pas ensemble : le 1er doit couper la feuille en morceaux de la taille de feuille du 2e, et le 2e doit couper ce format dans chaque morceau."
      );
    }
    layout = twoPass.layout;
    duploPieces = twoPass.pieces;
  } else if (input.duploJob) {
    layout = computeDuploLayout({
      job: input.duploJob,
      sheetWidth: input.sheetWidth,
      sheetHeight: input.sheetHeight,
      pieceWidth: input.pieceWidth,
      pieceHeight: input.pieceHeight,
      bleedMm: input.pieceBleedMm ?? 0,
      orientation: input.orientation,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
    });
    if (!layout) throw new Error("Ce job Duplo ne convient pas à cette feuille ou à ce format de pièce.");
  } else {
    layout = computeLayout(input);
  }
  if (layout.cells.length === 0) {
    throw new Error(
      `Le format (${fmtMm(input.pieceWidth)} × ${fmtMm(
        input.pieceHeight
      )}) ne rentre pas dans la zone utile de la feuille.`
    );
  }
  return { layout, duploPieces };
}

export async function imposeToPdf(input: ImposeInput): Promise<ImposeResult> {
  const { layout, duploPieces } = impositionLayout(input);

  const { assignment, overflow } = assignCells(input.sources, layout.cells.length);
  if (overflow > 0) {
    throw new Error(
      `Trop de copies : ${overflow} de plus que les ${layout.cells.length} emplacements de la feuille.`
    );
  }
  const placed = assignment.filter((a) => a !== null).length;
  if (placed === 0) throw new Error("Aucune copie à placer sur la feuille.");

  const out = await PDFDocument.create();
  const prepared: PreparedSource[] = [];
  const cache: SourceCache = { docs: new Map(), embedded: new Map() };
  for (const source of input.sources) {
    prepared.push(await prepareSource(out, source, input.pieceWidth, input.pieceHeight, cache));
  }

  const sheetWidthPt = mmToPt(input.sheetWidth);
  const sheetHeightPt = mmToPt(input.sheetHeight);

  const layers = new Layers(out);
  const front = out.addPage([sheetWidthPt, sheetHeightPt]);
  // Un PDF déjà dans le sens de la cellule reste à l'endroit ; sinon (cellule
  // couchée, ou PDF fourni dans l'orientation inverse du format) on le tourne
  // de 90°. Le verso reprend la rotation du recto (voir plus bas).
  function frontRotationFor(source: PreparedSource, cell: Cell): Rotation {
    return close(source.pageWidth, cell.width) && close(source.pageHeight, cell.height) ? 0 : 90;
  }

  // Premier calque (en bas) : le code-barres et les repères. Les visuels passent
  // par-dessus, un calque par visuel, aussi bien au recto qu'au verso.
  if (input.marks || input.barcode || input.regMark) {
    const marksLayer = input.barcode || input.regMark ? "Marques (code-barres et repère REG)" : "Marques de découpe";
    await inLayer(front, layers.add(marksLayer), async () => {
      if (input.marks) await drawMarks(out, front, input.marks, sheetWidthPt, sheetHeightPt);
      if (input.barcode) await drawBarcode(out, front, input.barcode, input.sheetWidth, input.sheetHeight);
      if (input.regMark) drawRegMark(front, input.regMark, input.sheetWidth, input.sheetHeight);
    });
  }
  const usedSources = [...new Set(assignment.filter((a): a is number => a !== null))].sort((a, b) => a - b);
  const visualLayers = new Map<number, Layer>(
    usedSources.map((index) => [index, layers.add(`Visuel ${index + 1} — ${prepared[index].name}`)])
  );
  for (const index of usedSources) {
    await inLayer(front, visualLayers.get(index)!, () => {
      layout.cells.forEach((cell, i) => {
        if (assignment[i] !== index) return;
        const source = prepared[index];
        drawPiece(front, source.front, cell, input.sheetHeight, frontRotationFor(source, cell));
      });
    });
  }

  // 2e passe : le code-barres et le repère du 2e job en haut de chaque
  // morceau coupé par le 1er, là où la machine les lit au 2e passage — par-dessus
  // les visuels (le fond perdu d'une pièce ne doit pas les masquer), mais jamais
  // sur une pièce finie.
  const second = input.secondPass ?? null;
  if (second && duploPieces.length > 0 && (second.barcode || second.regMark)) {
    const bleed = input.pieceBleedMm ?? 0;
    const finished = layout.cells.map((c) => ({ x: c.x + bleed, y: c.y + bleed, width: c.width - 2 * bleed, height: c.height - 2 * bleed }));
    const overlaps = (r: { x: number; y: number; width: number; height: number }) =>
      finished.some((f) => r.x < f.x + f.width - 0.01 && r.x + r.width > f.x + 0.01 && r.y < f.y + f.height - 0.01 && r.y + r.height > f.y + 0.01);
    await inLayer(front, layers.add("Marques 2e passe (sur chaque morceau)"), async () => {
      for (const piece of duploPieces) {
        const marks = piece.rotated ? turnedMarks(second) : second;
        if (marks.barcode) {
          const rect = await drawBarcode(out, front, marks.barcode, input.sheetWidth, input.sheetHeight, piece);
          if (overlaps(rect)) {
            throw new Error(
              "Le code-barres de la 2e passe tomberait sur une pièce finie : le 2e job ne laisse pas assez de place au-dessus des pièces."
            );
          }
        }
        if (marks.regMark) drawRegMark(front, marks.regMark, input.sheetWidth, input.sheetHeight, piece);
      }
    });
  }

  // Verso : seulement pour les sources qui ont une 2e page, aux positions
  // miroir du recto, sans marques (la découpeuse lit le recto).
  const hasBack = assignment.some((a) => a !== null && prepared[a].back !== null);
  if (hasBack) {
    const verticalAxis = flipAxisIsVertical(input.sheetWidth, input.sheetHeight, input.flip);
    const back = out.addPage([sheetWidthPt, sheetHeightPt]);
    for (const index of usedSources) {
      const source = prepared[index];
      if (!source.back) continue;
      const sourceBack = source.back;
      await inLayer(back, visualLayers.get(index)!, () => {
        layout.cells.forEach((cell, i) => {
          if (assignment[i] !== index) return;
          const backRotation = backRotationFor(frontRotationFor(source, cell), verticalAxis);
          const mirrored = mirrorCell(cell, input.sheetWidth, input.sheetHeight, verticalAxis);
          drawPiece(back, sourceBack, mirrored, input.sheetHeight, backRotation);
        });
      });
    }
  }

  layers.finish();
  return { pdf: Buffer.from(await out.save()), layout, placed, hasBack };
}

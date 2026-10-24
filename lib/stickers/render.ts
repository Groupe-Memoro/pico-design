// Rendu PDF des planches d'autocollants : le visuel du graphiste, le nom dans
// chaque zone (en contours vectoriels, net à toute taille), puis les codes
// Graphtec par-dessus. Une page par nom, dans un seul PDF.

import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFImage, type PDFPage } from "pdf-lib";
import { mmToPt } from "@/lib/pdf/units";
import { loadInstance, preloadFonts } from "@/lib/pdf/textLayer";
import { fontOptionById } from "@/lib/design/fonts";
import { detectMarksKind } from "@/lib/imposition/marks";
import { displayText, fitFontMm, type StickerTemplate, type StickerZone } from "./types";
import type { StickerSheetLayout } from "./layout";

// Un calque pleine feuille : page de PDF ou image, étirée à la taille de la planche.
type SheetLayer = { kind: "pdf"; page: PDFEmbeddedPage } | { kind: "image"; image: PDFImage };

export const MAX_NAMES_PER_PDF = 200;

async function embedLayer(out: PDFDocument, bytes: Uint8Array | null, label: string): Promise<SheetLayer | null> {
  if (!bytes) return null;
  const kind = detectMarksKind(bytes);
  try {
    if (kind === "pdf") {
      const [page] = await out.embedPdf(await PDFDocument.load(bytes), [0]);
      return { kind: "pdf", page };
    }
    if (kind === "png") return { kind: "image", image: await out.embedPng(bytes) };
    if (kind === "jpg") return { kind: "image", image: await out.embedJpg(bytes) };
  } catch {
    // Illisible : signalé plus bas, avec le nom du fichier.
  }
  throw new Error(`${label} du modèle est illisible : PDF, PNG ou JPEG attendu.`);
}

// Un calque étiré sur un rectangle (en points, origine en bas à gauche).
function drawLayer(page: PDFPage, layer: SheetLayer, rect: { x: number; y: number; width: number; height: number }) {
  if (layer.kind === "pdf") page.drawPage(layer.page, rect);
  else page.drawImage(layer.image, rect);
}

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

// Mesures d'un texte pour 1 mm de corps : largeur, et hauteur ascendante →
// descendante (pour le centrage vertical et l'ajustement en hauteur).
function measureZoneText(zone: StickerZone, text: string) {
  const font = loadInstance(fontOptionById(zone.fontId), false, zone.bold);
  const run = font.layout(text);
  const advance = run.glyphs.reduce((sum, g) => sum + g.advanceWidth, 0);
  // Approche de la première et de la dernière lettre : retirée, pour que le
  // dessin des lettres touche le bord de la zone.
  const first = run.glyphs[0];
  const last = run.glyphs[run.glyphs.length - 1];
  const lsb = first ? first.bbox.minX : 0;
  const rsb = last ? last.advanceWidth - last.bbox.maxX : 0;
  return {
    font,
    widthPerMm: Math.max(0, advance - lsb - rsb) / font.unitsPerEm,
    lsbPerMm: lsb / font.unitsPerEm,
    heightPerMm: (font.ascent - font.descent) / font.unitsPerEm,
    ascentPerMm: font.ascent / font.unitsPerEm,
    descentPerMm: font.descent / font.unitsPerEm,
    glyphs: run.glyphs,
  };
}

// Le nom dans une zone, en un seul chemin vectoriel : chaque glyphe est mis à
// l'échelle et placé en coordonnées « vers le bas » autour du centre de la
// zone, tourné au besoin, puis posé au centre de la zone sur la page.
function drawZoneText(page: PDFPage, zone: StickerZone, name: string, layout: StickerSheetLayout) {
  const text = displayText(zone, name);
  if (!text) return;
  const m = measureZoneText(zone, text);
  const sizeMm = fitFontMm(zone, m.widthPerMm, m.heightPerMm);
  const sizePt = mmToPt(sizeMm);
  const scale = sizePt / m.font.unitsPerEm;

  const turned = zone.rotation % 180 !== 0;
  const boxW = mmToPt(turned ? zone.height : zone.width);
  const inkW = m.widthPerMm * sizePt;
  // Début du dessin des lettres par rapport au centre de la zone (sans marge
  // intérieure), puis départ de la ligne (avant l'approche de la 1re lettre).
  const inkStart = zone.align === "left" ? -boxW / 2 : zone.align === "right" ? boxW / 2 - inkW : -inkW / 2;
  const startX = inkStart - m.lsbPerMm * sizePt;
  // Ligne de base : le bloc ascendante-descendante centré verticalement (Y vers le bas).
  const baseline = ((m.ascentPerMm + m.descentPerMm) / 2) * sizePt;

  const angle = (zone.rotation * Math.PI) / 180;
  let x = startX;
  let d = "";
  for (const glyph of m.glyphs) {
    const path = glyph.path.scale(scale, -scale).translate(x, baseline).rotate(angle);
    d += path.toSVG();
    x += glyph.advanceWidth * scale;
  }
  if (!d) return;
  // Zone mesurée depuis le coin de la planche, posée sur la feuille.
  const centerXPt = mmToPt(layout.area.x + zone.x + zone.width / 2);
  const centerYPt = mmToPt(layout.sheetHeight - (layout.area.y + zone.y + zone.height / 2));
  page.drawSvgPath(d, { x: centerXPt, y: centerYPt, color: hexToRgb(zone.color), borderWidth: 0 });
}

export interface StickerFiles {
  artwork: Uint8Array | null;
  marks: Uint8Array | null;
}

export async function renderStickerSheets(
  template: StickerTemplate,
  files: StickerFiles,
  names: string[],
  layout: StickerSheetLayout
): Promise<Buffer> {
  // Polices Google Fonts des zones, téléchargées avant le rendu.
  await preloadFonts(template.zones.map((z) => ({ fontId: z.fontId, bold: z.bold })));
  const out = await PDFDocument.create();
  const widthPt = mmToPt(layout.sheetWidth);
  const heightPt = mmToPt(layout.sheetHeight);
  // La planche dans la feuille (marges et calibration du profil, s'il y en a un).
  const areaRect = {
    x: mmToPt(layout.area.x),
    y: mmToPt(layout.sheetHeight - layout.area.y - layout.area.height),
    width: mmToPt(layout.area.width),
    height: mmToPt(layout.area.height),
  };
  const sheetRect = { x: 0, y: 0, width: widthPt, height: heightPt };
  const artwork = await embedLayer(out, files.artwork, "Le visuel");
  const marks = await embedLayer(out, files.marks, "Le fichier des codes Graphtec");

  for (const name of names) {
    const page = out.addPage([widthPt, heightPt]);
    if (artwork) drawLayer(page, artwork, areaRect);
    for (const zone of template.zones) drawZoneText(page, zone, name, layout);
    // Les codes par-dessus tout, sur toute la feuille : rien ne doit masquer
    // ce que lit la Graphtec.
    if (marks) drawLayer(page, marks, sheetRect);
  }
  return Buffer.from(await out.save());
}

// Noms saisis (un par ligne) : espaces normalisés, lignes vides retirées.
export function parseNames(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((n) => n.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean);
}

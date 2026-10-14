import type { Font } from "fontkit";
import { rgb, type PDFPage } from "pdf-lib";
import { fontOptionById } from "../design/fonts";
import { loadInstance } from "../pdf/textLayer";
import type { LayoutElement } from "./elements";

/**
 * Texte d'un document multipage dans le PDF : mesuré avec les vraies polices (celles de
 * l'outil de design, public/fonts), coupé en lignes, rétréci s'il déborde de
 * sa boîte, puis dessiné en CONTOURS de glyphes (vectoriel, net à toute
 * taille, sans police à embarquer — voir lib/pdf/textLayer.ts).
 */

const MM_TO_PT = 72 / 25.4;
const LINE_HEIGHT = 1.25;
const MIN_SCALE = 0.6;

type TextElement = Extract<LayoutElement, { type: "text" }>;

export function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function widthPt(font: Font, text: string, size: number): number {
  return (font.layout(text).advanceWidth * size) / font.unitsPerEm;
}

// Coupe aux espaces ; un mot trop long pour la largeur reste seul sur sa ligne
// (il fera rétrécir le texte).
function wrap(font: Font, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (widthPt(font, candidate, size) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Lignes et taille qui tiennent dans la boîte : la taille demandée si possible,
// sinon plus petite (jusqu'à 60 %), sinon coupée avec « … ».
export function fitText(font: Font, el: TextElement): { lines: string[]; size: number } {
  const maxWidth = el.w * MM_TO_PT;
  for (let size = el.size; size >= el.size * MIN_SCALE; size *= 0.94) {
    const lines = wrap(font, el.text, size, maxWidth);
    if (lines.length <= el.maxLines && lines.every((l) => widthPt(font, l, size) <= maxWidth)) return { lines, size };
  }
  const size = el.size * MIN_SCALE;
  const lines = wrap(font, el.text, size, maxWidth).slice(0, el.maxLines);
  const last = lines.length - 1;
  while (lines[last] && widthPt(font, `${lines[last]}…`, size) > maxWidth) lines[last] = lines[last].slice(0, -1);
  if (lines[last] !== undefined) lines[last] = `${lines[last].trimEnd()}…`;
  return { lines, size };
}

// Chemin SVG d'une ligne (unités de la police, y vers le bas), origine sur sa
// ligne de base : pdf-lib le met à l'échelle et retourne l'axe y.
function linePath(font: Font, text: string): string {
  const run = font.layout(text);
  let x = 0;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.scale(1, -1).translate(x, 0).toSVG();
    if (d) parts.push(d);
    x += run.positions[i].xAdvance;
  });
  return parts.join(" ");
}

export function drawText(page: PDFPage, el: TextElement, pageHeightPt: number) {
  if (!el.text.trim()) return;
  const font = loadInstance(fontOptionById(el.font), false, el.bold) as Font;
  const { lines, size } = fitText(font, el);
  const scale = size / font.unitsPerEm;
  const ascent = font.ascent * scale;
  const lineGap = size * LINE_HEIGHT;
  const left = el.x * MM_TO_PT;
  const top = pageHeightPt - el.y * MM_TO_PT;
  const color = hexToRgb(el.color);
  lines.forEach((line, i) => {
    if (!line) return;
    const w = widthPt(font, line, size);
    const x =
      el.align === "center" ? left + (el.w * MM_TO_PT - w) / 2 : el.align === "right" ? left + el.w * MM_TO_PT - w : left;
    const path = linePath(font, line);
    if (path) page.drawSvgPath(path, { x, y: top - ascent - i * lineGap, scale, color });
  });
}

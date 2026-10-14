import type { Font } from "fontkit";
import { fontOptionById } from "../design/fonts";
import { loadInstance } from "./textLayer";

/**
 * Texte en contours SVG (`<path>`), pour les images que sharp compose : le
 * serveur n'a aucune police système, un `<text>` SVG y sortirait en petits
 * rectangles (voir exampleLabel.ts). Mêmes polices que l'outil de design.
 *
 * Le texte est centré sur (cx, baseline), avec un liseré blanc pour rester
 * lisible sur n'importe quel visuel.
 */
export function svgCenteredText(text: string, cx: number, baseline: number, sizePx: number, color: string, maxWidthPx?: number): string {
  if (!text) return "";
  const font = loadInstance(fontOptionById("inter"), false, true) as Font;
  let size = sizePx;
  const width = () => (font.layout(text).advanceWidth * size) / font.unitsPerEm;
  if (maxWidthPx && width() > maxWidthPx) size = Math.max(sizePx * 0.5, (size * maxWidthPx) / width());
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let x = 0;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.scale(1, -1).translate(x, 0).toSVG();
    if (d) parts.push(d);
    x += run.positions[i].xAdvance;
  });
  const left = cx - (run.advanceWidth * scale) / 2;
  const d = parts.join(" ");
  const transform = `translate(${left} ${baseline}) scale(${scale})`;
  const halo = Math.max(2, size * 0.18) / scale;
  return `<g transform="${transform}"><path d="${d}" fill="none" stroke="#ffffff" stroke-width="${halo}" stroke-linejoin="round"/><path d="${d}" fill="${color}"/></g>`;
}

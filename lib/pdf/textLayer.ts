// Imports nommés plutôt que `import fontkit from "fontkit"` : le module n'a
// pas d'export par défaut (seulement des exports nommés) — un import par
// défaut se contente d'une interop TypeScript (esModuleInterop) qui ne
// tient pas forcément à l'exécution selon le bundler (vérifié : échoue sous
// Node/ESM strict, malgré un `tsc` propre).
import { create, openSync, type Font } from "fontkit";
import path from "path";
import { mmToPx } from "./units";
import { fontOptionById, resolveFontFile, type FontOption } from "../design/fonts";
import type { TextLayer } from "../design/layers";
import type { ThemeTextZone } from "../types";
import { THEME_TEXT_LINE_HEIGHT, fitThemeTextSize } from "../themeText";

// Rendu du texte en contours de glyphes (chemins SVG), via `fontkit` — pas
// de police "installée" à trouver sur le serveur (fontconfig, dans le sharp
// bundlé, ne s'est pas montré fiable d'un environnement à l'autre lors des
// essais) : chaque glyphe est directement transformé en `<path>`, portable
// partout où Node tourne. Les fichiers (public/fonts/*.ttf) sont les mêmes
// que ceux chargés côté client (@font-face, voir globals.css) pour un
// aperçu fidèle à l'impression.

// Polices variables (axe "wght") : une même police ouverte plusieurs fois à
// des graisses différentes reste bon marché une fois mise en cache — le
// fichier n'est lu et parsé qu'une fois par process.
const openFontCache = new Map<string, Font>();
// Instances (graisse figée) tirées d'une police variable — `getVariation`
// n'est pas gratuit non plus.
const variationCache = new Map<string, Font>();

function openFont(publicPath: string): Font {
  const cached = openFontCache.get(publicPath);
  if (cached) return cached;
  const absolute = path.join(process.cwd(), "public", publicPath);
  const font = openSync(absolute) as Font;
  openFontCache.set(publicPath, font);
  return font;
}

// Polices Google Fonts téléchargées (voir preloadFonts), par famille, graisse
// et style. `loadInstance` est synchrone : elles doivent être chargées avant.
const googleFontCache = new Map<string, Font>();
const googleFontPending = new Map<string, Promise<void>>();

// Graisse et style réellement disponibles pour une police Google.
function googleVariant(font: FontOption, italic: boolean, bold: boolean): { weight: number; ital: 0 | 1; key: string } {
  const weight = bold ? font.weightBold : font.weightRegular;
  const ital = italic && (font.italicWeights?.length ?? 0) > 0 ? 1 : 0;
  return { weight, ital, key: `${font.family}|${weight}|${ital}` };
}

/**
 * Télécharge chez Google les polices du catalogue nécessaires à un rendu, une
 * seule fois par instance du serveur. Sans navigateur reconnu, Google sert un
 * fichier TrueType unique, lisible par fontkit. Une police introuvable n'est
 * pas bloquante : le texte retombe sur Inter (voir loadInstance).
 */
export async function preloadFonts(requests: { fontId: string; italic?: boolean; bold?: boolean }[]): Promise<void> {
  await Promise.all(
    requests.map(({ fontId, italic = false, bold = false }) => {
      const font = fontOptionById(fontId);
      if (!font.google) return Promise.resolve();
      const { weight, ital, key } = googleVariant(font, italic, bold);
      if (googleFontCache.has(key)) return Promise.resolve();
      let pending = googleFontPending.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            const family = encodeURIComponent(font.family).replace(/%20/g, "+");
            const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:ital,wght@${ital},${weight}`)).text();
            const url = css.match(/url\((https:[^)]+)\)/)?.[1];
            if (!url) throw new Error("adresse du fichier introuvable");
            const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
            googleFontCache.set(key, create(bytes) as Font);
          } catch (err) {
            console.warn(`Police Google « ${font.family} » (${weight}${ital ? " italique" : ""}) indisponible :`, err);
          } finally {
            googleFontPending.delete(key);
          }
        })();
        googleFontPending.set(key, pending);
      }
      return pending;
    })
  );
}

export function loadInstance(font: FontOption, italic: boolean, bold: boolean): Font {
  if (font.google) {
    const cached = googleFontCache.get(googleVariant(font, italic, bold).key);
    if (cached) return cached;
    // Non chargée (voir preloadFonts) : Inter plutôt qu'un rendu en erreur.
    return loadInstance(fontOptionById("inter"), italic, bold);
  }
  const filePath = resolveFontFile(font, italic);
  const weight = bold ? font.weightBold : font.weightRegular;
  const key = `${filePath}:${weight}`;
  const cached = variationCache.get(key);
  if (cached) return cached;
  const base = openFont(filePath);
  // `getVariation` sur une police non variable (aucune de nos polices n'est
  // dans ce cas ici) renvoie simplement la police telle quelle — sans risque.
  const instance = (typeof base.getVariation === "function" ? base.getVariation({ wght: weight }) : base) as Font;
  variationCache.set(key, instance);
  return instance;
}

interface LaidOutLine {
  // `<path>` par glyphe, déjà positionnés/mis à l'échelle sur la ligne
  // (origine locale : (0,0) = point de départ de la ligne sur sa ligne de
  // base, Y vers le bas — comme le SVG, contrairement à l'espace em de la
  // police, Y vers le haut, d'où le `scale(.. -..)`).
  paths: string;
  widthPx: number;
}

function layoutLine(font: Font, text: string, fontSizePx: number, letterSpacingPx: number): LaidOutLine {
  const scale = fontSizePx / font.unitsPerEm;
  const run = font.layout(text);
  let x = 0;
  let paths = "";
  const glyphCount = run.glyphs.length;
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.toSVG();
    if (d) {
      paths += `<path transform="translate(${x} 0) scale(${scale} ${-scale})" d="${d}"/>`;
    }
    x += glyph.advanceWidth * scale;
    // Pas d'espacement après le dernier glyphe — sinon la ligne mesurerait
    // (et centrerait/alignerait) un blanc superflu à sa droite, comme le
    // fait déjà `letter-spacing` en CSS dans les navigateurs récents.
    if (i < glyphCount - 1) x += letterSpacingPx;
  });
  return { paths, widthPx: x };
}

// Groupe SVG (`<g>`) positionné pour ce calque de texte, prêt à composer
// (voir lib/pdf/layers.ts) sur un canevas de `targetWidthPx`×`targetHeightPx`
// (la page, fond perdu compris, à la résolution `dpi` voulue).
export function textLayerToSvgGroup(
  layer: TextLayer,
  targetWidthPx: number,
  targetHeightPx: number,
  dpi: number
): string {
  const fontOption = fontOptionById(layer.fontId);
  const instance = loadInstance(fontOption, layer.italic, layer.bold);
  const fontSizePx = mmToPx(layer.fontSizeMm, dpi);
  // Interligne courant (1.25×) — les polices n'exposent pas toutes une
  // valeur d'interligne "recommandée" fiable pour du texte court comme ici.
  const lineHeightPx = fontSizePx * 1.25;
  const ascentPx = (instance.ascent / instance.unitsPerEm) * fontSizePx;

  const letterSpacingPx = mmToPx(layer.letterSpacingMm ?? 0, dpi);
  const rawLines = layer.content.split("\n");
  const lines = rawLines.map((line) => layoutLine(instance, line, fontSizePx, letterSpacingPx));
  const maxWidthPx = Math.max(1, ...lines.map((l) => l.widthPx));
  const totalHeightPx = lineHeightPx * lines.length;

  const centerX = layer.positionX * targetWidthPx;
  const centerY = layer.positionY * targetHeightPx;
  const blockLeft = centerX - maxWidthPx / 2;
  const blockTop = centerY - totalHeightPx / 2;

  // Chaque ligne centrée dans le bloc (plusieurs lignes n'ont pas forcément
  // la même largeur) — l'alignement gauche/droite réglable a été retiré :
  // sans effet visible tant que le bloc lui-même reste centré sur son point
  // d'ancrage, il n'apportait rien pour la quasi-totalité des textes (une
  // seule ligne).
  const lineGroups = lines
    .map((line, i) => {
      const lineLeft = (maxWidthPx - line.widthPx) / 2;
      const baselineY = i * lineHeightPx + ascentPx;
      return `<g transform="translate(${lineLeft} ${baselineY})">${line.paths}</g>`;
    })
    .join("");

  // Bordure (contour) en DEUX passes : tout le texte est d'abord tracé en
  // contour seul, puis redessiné plein par-dessus. `paint-order="stroke fill"`
  // ne suffisait pas : il s'applique glyphe par glyphe, si bien que le contour
  // d'une lettre repassait sur le plein de la précédente — visible dès que les
  // lettres se touchent (crénage serré, interlettrage négatif, italiques).
  // Deux passes = un contour continu derrière un texte intact, ce que les
  // polices non dessinées pour être contournées supportent bien mieux.
  //
  // La bordure est ENTIÈREMENT extérieure au glyphe : un trait SVG est centré
  // sur le contour, donc on en trace le double et le texte plein recouvre la
  // moitié intérieure. L'épaisseur réglée par le client (en mm) est ainsi
  // celle qu'on voit déborder de la lettre, et la lettre garde sa forme.
  //
  // Le `stroke-width` doit être exprimé dans l'espace de la POLICE, pas en
  // pixels du canevas : chaque glyphe porte un `scale(fontSize/unitsPerEm)`
  // (voir layoutLine) qui s'applique aussi au trait. Sans cette division, une
  // bordure réglée à 7 mm n'en mesurait que 3,2 — l'écart passait inaperçu
  // faute d'être mesuré.
  const glyphScale = fontSizePx / instance.unitsPerEm;
  const strokeWidthPx = mmToPx(layer.strokeWidthMm ?? 0, dpi);
  const strokePass =
    strokeWidthPx > 0 && glyphScale > 0
      ? `<g fill="none" stroke="${layer.strokeColor}" stroke-width="${
          (strokeWidthPx * 2) / glyphScale
        }" stroke-linejoin="${layer.strokeJoin ?? "round"}" stroke-linecap="${
          (layer.strokeJoin ?? "round") === "round" ? "round" : "butt"
        }" stroke-miterlimit="4">${lineGroups}</g>`
      : "";

  // Rotation autour du centre du bloc — appliquée en dernier (englobe tout),
  // pour tourner le texte déjà mis en page plutôt que de complexifier la
  // mise en page elle-même.
  const rotationDeg = layer.rotationDeg ?? 0;
  const rotateAttr = rotationDeg ? `rotate(${rotationDeg} ${centerX} ${centerY}) ` : "";

  return `<g transform="${rotateAttr}translate(${blockLeft} ${blockTop})" fill="${layer.color}" opacity="${layer.opacity ?? 1}">${strokePass}<g>${lineGroups}</g></g>`;
}

/**
 * Texte d'une zone de thème (voir lib/themeText.ts), en `<g>` SVG sur un
 * canevas de `targetWidthPx`×`targetHeightPx` (la page, fond perdu compris) :
 * réduit au besoin pour tenir dans la zone, centré verticalement, aligné à
 * gauche, au centre ou à droite. "" si le texte est vide.
 */
export function themeTextToSvgGroup(
  zone: ThemeTextZone,
  text: string,
  targetWidthPx: number,
  targetHeightPx: number,
  dpi: number
): string {
  if (!text.trim()) return "";
  const instance = loadInstance(fontOptionById(zone.fontId), zone.italic, zone.bold);
  const boxW = zone.widthRatio * targetWidthPx;
  const boxH = zone.heightRatio * targetHeightPx;
  const baseSizePx = mmToPx(zone.fontSizeMm, dpi);
  const rawLines = text.split("\n");
  const measured = rawLines.map((line) => layoutLine(instance, line, baseSizePx, 0).widthPx);
  const sizePx = fitThemeTextSize(baseSizePx, measured, boxW, boxH);
  const lines = rawLines.map((line) => layoutLine(instance, line, sizePx, 0));
  const lineHeightPx = sizePx * THEME_TEXT_LINE_HEIGHT;
  const ascentPx = (instance.ascent / instance.unitsPerEm) * sizePx;
  // Hauteur réelle de la police (ascendante + descendante) : c'est elle que
  // le navigateur centre dans l'interligne, l'aperçu tombe donc au même endroit.
  const contentPx = ((instance.ascent - instance.descent) / instance.unitsPerEm) * sizePx;
  const boxLeft = zone.positionX * targetWidthPx - boxW / 2;
  const blockTop = zone.positionY * targetHeightPx - (lineHeightPx * lines.length) / 2;
  const groups = lines
    .map((line, i) => {
      const x = zone.align === "left" ? boxLeft : zone.align === "right" ? boxLeft + boxW - line.widthPx : boxLeft + (boxW - line.widthPx) / 2;
      // Le surplus d'interligne réparti au-dessus et au-dessous de la ligne.
      const baseline = blockTop + i * lineHeightPx + (lineHeightPx - contentPx) / 2 + ascentPx;
      return `<g transform="translate(${x} ${baseline})">${line.paths}</g>`;
    })
    .join("");
  const rotation = zone.rotationDeg ?? 0;
  const rotate = rotation ? ` transform="rotate(${rotation} ${zone.positionX * targetWidthPx} ${zone.positionY * targetHeightPx})"` : "";
  return `<g fill="${zone.color}"${rotate}>${groups}</g>`;
}

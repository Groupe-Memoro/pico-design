import sharp from "sharp";
import type { Blend, OverlayOptions } from "sharp";
import { preloadFonts, textLayerToSvgGroup } from "./textLayer";
import { shapeLayerToSvgGroup } from "./shapeLayer";
import {
  layerImageFieldName,
  type BlendMode,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from "../design/layers";

// Un calque texte/forme (rien à résoudre au préalable) ou un calque image
// (son fichier déjà téléchargé/lu en Buffer par l'appelant — voir
// app/api/design/pdf/route.ts et app/api/design/mockup/route.ts, qui lisent
// chacun le champ de formulaire du calque, voir layerImageFieldName).
export type ResolvedLayer =
  | { type: "text"; layer: TextLayer }
  | { type: "image"; layer: ImageLayer; buffer: Buffer }
  | { type: "shape"; layer: ShapeLayer };

// sharp/libvips utilise l'orthographe britannique pour ces deux-là
// ("colour-…") — notre type BlendMode garde l'orthographe CSS/américaine
// (partagée avec l'aperçu écran, `mix-blend-mode`), traduite ici seulement.
function sharpBlendFor(mode: BlendMode): string {
  if (mode === "color-dodge") return "colour-dodge";
  if (mode === "color-burn") return "colour-burn";
  if (mode === "normal") return "over";
  return mode;
}

/**
 * Compose des calques (texte/image/forme, dans l'ordre — le premier tout en
 * bas) par-dessus une image de fond déjà à la taille cible exacte
 * (`targetWidthPx`×`targetHeightPx` — typiquement la sortie de
 * `coverCropToBuffer`). Réutilisé par le PDF final et les deux mockups
 * (réaliste et papeterie) : un seul endroit qui sait dessiner des calques.
 *
 * `dpi` sert uniquement à convertir les tailles en mm (police, bordure) en
 * pixels — voir textLayerToSvgGroup/shapeLayerToSvgGroup.
 */
export async function compositeLayers(
  base: Buffer,
  layers: ResolvedLayer[],
  targetWidthPx: number,
  targetHeightPx: number,
  dpi: number
): Promise<Buffer> {
  if (layers.length === 0) return base;
  // Polices Google Fonts des calques de texte, téléchargées avant le rendu.
  await preloadFonts(
    layers.flatMap((r) => (r.type === "text" ? [{ fontId: r.layer.fontId, italic: r.layer.italic, bold: r.layer.bold }] : []))
  );

  const overlays: OverlayOptions[] = [];
  for (const resolved of layers) {
    if (resolved.type === "text") {
      if (!resolved.layer.content.trim()) continue;
      const group = textLayerToSvgGroup(resolved.layer, targetWidthPx, targetHeightPx, dpi);
      const svg = `<svg width="${targetWidthPx}" height="${targetHeightPx}" xmlns="http://www.w3.org/2000/svg">${group}</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      overlays.push({ input: png, left: 0, top: 0, blend: sharpBlendFor(resolved.layer.blendMode) as Blend });
    } else if (resolved.type === "shape") {
      const group = shapeLayerToSvgGroup(resolved.layer, targetWidthPx, targetHeightPx, dpi);
      const svg = `<svg width="${targetWidthPx}" height="${targetHeightPx}" xmlns="http://www.w3.org/2000/svg">${group}</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      overlays.push({ input: png, left: 0, top: 0, blend: sharpBlendFor(resolved.layer.blendMode) as Blend });
    } else {
      const widthPx = Math.max(1, Math.round(resolved.layer.widthRatio * targetWidthPx));
      const meta = await sharp(resolved.buffer).metadata();
      const naturalW = meta.width ?? widthPx;
      const naturalH = meta.height ?? widthPx;
      const heightPx = Math.max(1, Math.round(widthPx * (naturalH / naturalW)));
      let resized = await sharp(resolved.buffer)
        .resize(widthPx, heightPx)
        .ensureAlpha()
        .png()
        .toBuffer();
      // Opacité : pas de réglage direct dans sharp.composite — on la "cuit"
      // dans le buffer en multipliant juste le canal alpha (RGB inchangés)
      // via `linear`, avant la rotation éventuelle (sans effet sur le fond
      // transparent qu'elle ajoute, déjà à alpha 0).
      const opacity = resolved.layer.opacity ?? 1;
      if (opacity < 1) {
        resized = await sharp(resized)
          .linear([1, 1, 1, Math.max(0, opacity)], [0, 0, 0, 0])
          .png()
          .toBuffer();
      }
      // Rotation : appliquée avant le positionnement, pas en overlay CSS
      // (sharp.composite ne tourne pas une image individuellement) — sharp
      // agrandit le canevas pour englober le rectangle tourné (fond
      // transparent), d'où la relecture des dimensions après coup, sinon le
      // centrage ci-dessous se ferait sur les dimensions d'avant rotation.
      let effectiveWidthPx = widthPx;
      let effectiveHeightPx = heightPx;
      const rotationDeg = resolved.layer.rotationDeg ?? 0;
      if (rotationDeg % 360 !== 0) {
        resized = await sharp(resized)
          .rotate(rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        const rotatedMeta = await sharp(resized).metadata();
        effectiveWidthPx = rotatedMeta.width ?? widthPx;
        effectiveHeightPx = rotatedMeta.height ?? heightPx;
      }
      // Centré sur (positionX, positionY), mais toujours borné à l'intérieur
      // du canevas (jamais un calque à moitié hors de la page). Une fois
      // tourné, le rectangle englobant peut dépasser la largeur du canevas
      // (calque large + rotation proche de 45°) — bornage par un maximum
      // avec 0 (plutôt qu'un simple Math.max(0, canvas-width)) pour rester
      // valide même dans ce cas, quitte à ce que le calque déborde un peu.
      const left = Math.min(
        Math.max(0, targetWidthPx - effectiveWidthPx),
        Math.max(0, Math.round(resolved.layer.positionX * targetWidthPx - effectiveWidthPx / 2))
      );
      const top = Math.min(
        Math.max(0, targetHeightPx - effectiveHeightPx),
        Math.max(0, Math.round(resolved.layer.positionY * targetHeightPx - effectiveHeightPx / 2))
      );
      overlays.push({ input: resized, left, top, blend: sharpBlendFor(resolved.layer.blendMode) as Blend });
    }
  }

  if (overlays.length === 0) return base;
  return sharp(base).composite(overlays).png().toBuffer();
}

function clamp01(n: unknown, fallback = 0.5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(1, Math.max(0, v));
}

// Degrés — n'importe quelle valeur finie est acceptée (une rotation "hors
// bornes" n'a rien de dangereux à rendre), juste ramenée dans [0, 360) pour
// rester lisible si jamais elle est réaffichée.
function normalizeRotation(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return ((v % 360) + 360) % 360;
}

function isHexColor(n: unknown): n is string {
  return typeof n === "string" && /^#[0-9a-fA-F]{6}$/.test(n);
}

function coerceOpacity(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 1;
  return Math.min(1, Math.max(0, v));
}

const VALID_BLEND_MODES = new Set<BlendMode>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
]);
function coerceBlendMode(n: unknown): BlendMode {
  return typeof n === "string" && VALID_BLEND_MODES.has(n as BlendMode) ? (n as BlendMode) : "normal";
}

function coerceTextLayer(raw: Record<string, unknown>): TextLayer | null {
  if (typeof raw.id !== "string" || typeof raw.content !== "string") return null;
  return {
    id: raw.id,
    type: "text",
    content: raw.content,
    fontId: typeof raw.fontId === "string" ? raw.fontId : "inter",
    fontSizeMm: typeof raw.fontSizeMm === "number" && raw.fontSizeMm > 0 ? raw.fontSizeMm : 10,
    bold: Boolean(raw.bold),
    italic: Boolean(raw.italic),
    letterSpacingMm: typeof raw.letterSpacingMm === "number" && Number.isFinite(raw.letterSpacingMm) ? raw.letterSpacingMm : 0,
    color: isHexColor(raw.color) ? raw.color : "#000000",
    positionX: clamp01(raw.positionX),
    positionY: clamp01(raw.positionY),
    rotationDeg: normalizeRotation(raw.rotationDeg),
    opacity: coerceOpacity(raw.opacity),
    blendMode: coerceBlendMode(raw.blendMode),
    strokeWidthMm: typeof raw.strokeWidthMm === "number" && raw.strokeWidthMm > 0 ? raw.strokeWidthMm : 0,
    strokeColor: isHexColor(raw.strokeColor) ? raw.strokeColor : "#ffffff",
    strokeJoin: raw.strokeJoin === "miter" || raw.strokeJoin === "bevel" ? raw.strokeJoin : "round",
  };
}

function coerceShapeLayer(raw: Record<string, unknown>): ShapeLayer | null {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    type: "shape",
    shape: raw.shape === "ellipse" ? "ellipse" : "rectangle",
    widthRatio: typeof raw.widthRatio === "number" && raw.widthRatio > 0 ? Math.min(3, raw.widthRatio) : 0.3,
    heightRatio: typeof raw.heightRatio === "number" && raw.heightRatio > 0 ? Math.min(3, raw.heightRatio) : 0.3,
    fillEnabled: raw.fillEnabled !== false,
    fillColor: isHexColor(raw.fillColor) ? raw.fillColor : "#631028",
    strokeWidthMm: typeof raw.strokeWidthMm === "number" && raw.strokeWidthMm > 0 ? raw.strokeWidthMm : 0,
    strokeColor: isHexColor(raw.strokeColor) ? raw.strokeColor : "#ffffff",
    positionX: clamp01(raw.positionX),
    positionY: clamp01(raw.positionY),
    rotationDeg: normalizeRotation(raw.rotationDeg),
    opacity: coerceOpacity(raw.opacity),
    blendMode: coerceBlendMode(raw.blendMode),
  };
}

/**
 * Lit et résout les calques d'un côté depuis le formulaire envoyé par le
 * client (voir DesignSummary.tsx, `appendLayersToForm`) : un champ JSON
 * (`${side}Layers`, juste les métadonnées — jamais les fichiers, qui ne
 * sont pas sérialisables) plus un champ fichier par calque image (voir
 * layerImageFieldName). Ne fait pas confiance aux valeurs reçues (client) :
 * tout ce qui ne correspond pas à la forme attendue retombe sur une valeur
 * par défaut sûre plutôt que d'échouer.
 */
export async function resolveLayersFromForm(formData: FormData, side: "front" | "back"): Promise<ResolvedLayer[]> {
  const raw = formData.get(`${side}Layers`);
  if (typeof raw !== "string" || !raw) return [];

  let descriptors: unknown[];
  try {
    const parsed = JSON.parse(raw);
    descriptors = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }

  const resolved: ResolvedLayer[] = [];
  for (const d of descriptors) {
    if (!d || typeof d !== "object") continue;
    const record = d as Record<string, unknown>;
    if (record.type === "text") {
      const layer = coerceTextLayer(record);
      if (layer) resolved.push({ type: "text", layer });
    } else if (record.type === "shape") {
      const layer = coerceShapeLayer(record);
      if (layer) resolved.push({ type: "shape", layer });
    } else if (record.type === "image") {
      if (typeof record.id !== "string") continue;
      const file = formData.get(layerImageFieldName(side, record.id));
      if (!(file instanceof File) || file.size === 0) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const widthRatio = record.widthRatio;
      const layer: ImageLayer = {
        id: record.id,
        type: "image",
        file: null,
        fileName: file.name,
        widthRatio: typeof widthRatio === "number" && widthRatio > 0 ? Math.min(1, widthRatio) : 0.4,
        positionX: clamp01(record.positionX),
        positionY: clamp01(record.positionY),
        rotationDeg: normalizeRotation(record.rotationDeg),
        opacity: coerceOpacity(record.opacity),
        blendMode: coerceBlendMode(record.blendMode),
      };
      resolved.push({ type: "image", layer, buffer });
    }
  }
  return resolved;
}

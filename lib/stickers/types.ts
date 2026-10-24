// Module Autocollants : modèles de planches et zones de texte. Types et règles
// pures, partagés entre l'éditeur de modèle (écran) et le rendu PDF (serveur).

import { FONT_OPTIONS, isKnownFontId } from "@/lib/design/fonts";

export const STICKER_ASSETS = ["artwork", "marks", "guide"] as const;
export type StickerAsset = (typeof STICKER_ASSETS)[number];

export const STICKER_ASSET_COLUMN: Record<StickerAsset, "artwork_path" | "marks_path" | "guide_path"> = {
  artwork: "artwork_path",
  marks: "marks_path",
  guide: "guide_path",
};

export const STICKER_ASSET_LABELS: Record<StickerAsset, string> = {
  artwork: "Visuel de la planche",
  marks: "Codes Graphtec",
  guide: "Gabarit de guidage des découpes",
};

export function isStickerAsset(value: unknown): value is StickerAsset {
  return (STICKER_ASSETS as readonly unknown[]).includes(value);
}

export type ZoneAlign = "left" | "center" | "right";
export type ZoneRotation = 0 | 90 | 180 | 270;

// Une zone de texte : un rectangle de la planche où s'écrit le nom. Le texte y
// est centré verticalement, aligné horizontalement, et sa taille réduite au
// besoin pour tenir (jamais au-delà de maxFontMm).
export interface StickerZone {
  id: string;
  // Rectangle en mm, depuis le coin haut-gauche de la feuille.
  x: number;
  y: number;
  width: number;
  height: number;
  fontId: string;
  bold: boolean;
  uppercase: boolean;
  color: string; // #rrggbb
  align: ZoneAlign;
  // Hauteur de corps maximale, en mm.
  maxFontMm: number;
  // Rotation du texte dans la zone (sens horaire), pour une étiquette verticale.
  rotation: ZoneRotation;
}

export interface StickerTemplate {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  artwork_path: string | null;
  marks_path: string | null;
  guide_path: string | null;
  // Profil de découpe Graphtec : feuille, marges, calibration et codes (voir
  // lib/stickers/layout.ts). Null : la planche occupe toute la feuille.
  cutter_id: string | null;
  zones: StickerZone[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// Plus petite taille de texte imprimée (mm) : en dessous, un nom trop long
// déborde plutôt que de devenir illisible — l'aperçu le montre.
const MIN_FONT_MM = 1.5;

/**
 * Taille du texte (mm) dans une zone : la plus grande qui tienne, sans
 * dépasser maxFontMm, sans marge intérieure (le texte peut toucher les bords
 * de la zone). `widthPerMm` est la largeur du dessin des lettres pour 1 mm de corps,
 * `heightPerMm` sa hauteur (ascendante à descendante) pour 1 mm : mesurées
 * par fontkit au serveur, par le canevas du navigateur à l'écran.
 */
export function fitFontMm(zone: StickerZone, widthPerMm: number, heightPerMm: number): number {
  const turned = zone.rotation % 180 !== 0;
  const boxW = turned ? zone.height : zone.width;
  const boxH = turned ? zone.width : zone.height;
  const byWidth = widthPerMm > 0 ? boxW / widthPerMm : zone.maxFontMm;
  const byHeight = heightPerMm > 0 ? boxH / heightPerMm : zone.maxFontMm;
  return Math.max(MIN_FONT_MM, Math.min(zone.maxFontMm, byWidth, byHeight));
}

export function displayText(zone: StickerZone, name: string): string {
  const text = name.replace(/\s+/g, " ").trim();
  return zone.uppercase ? text.toLocaleUpperCase("fr-CA") : text;
}

let zoneCounter = 0;
export function newZone(partial: Partial<StickerZone> = {}): StickerZone {
  zoneCounter += 1;
  return {
    id: `zone-${Date.now().toString(36)}-${zoneCounter}`,
    x: 10,
    y: 10,
    width: 40,
    height: 12,
    fontId: FONT_OPTIONS[0].id,
    bold: true,
    uppercase: false,
    color: "#1a1613",
    align: "center",
    maxFontMm: 8,
    rotation: 0,
    ...partial,
  };
}

// Zones reçues d'un formulaire : tout est revérifié, rien n'est pris tel quel.
export function parseZones(raw: unknown, sheetW: number, sheetH: number): StickerZone[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null;
  const zones: StickerZone[] = [];
  for (const z of raw as Record<string, unknown>[]) {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const x = n(z.x), y = n(z.y), w = n(z.width), h = n(z.height), max = n(z.maxFontMm);
    if (![x, y, w, h, max].every((v) => !Number.isNaN(v))) return null;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > sheetW + 0.01 || y + h > sheetH + 0.01) return null;
    const rotation = [0, 90, 180, 270].includes(Number(z.rotation)) ? (Number(z.rotation) as ZoneRotation) : 0;
    zones.push({
      id: typeof z.id === "string" && z.id.length <= 64 ? z.id : `zone-${zones.length + 1}`,
      x, y, width: w, height: h,
      fontId: isKnownFontId(z.fontId) ? z.fontId : FONT_OPTIONS[0].id,
      bold: z.bold === true,
      uppercase: z.uppercase === true,
      color: typeof z.color === "string" && /^#[0-9a-f]{6}$/i.test(z.color) ? z.color : "#1a1613",
      align: z.align === "left" || z.align === "right" ? z.align : "center",
      maxFontMm: Math.min(200, Math.max(MIN_FONT_MM, max)),
      rotation,
    });
  }
  return zones;
}

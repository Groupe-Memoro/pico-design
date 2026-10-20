import { FONT_OPTIONS } from "@/lib/design/fonts";
import type { ThemeTextAlign, ThemeTextZone } from "@/lib/types";

/**
 * Zones de texte des thèmes : règles communes à l'éditeur de thème, à l'outil
 * Shopify (aperçu) et au serveur (rendu), pour que le texte tombe au même
 * endroit et à la même taille partout. Sans dépendance serveur.
 */

export const MAX_THEME_TEXT_ZONES = 20;
// Texte d'une zone : au plus ce nombre de caractères, même sans limite fixée.
export const MAX_THEME_TEXT_LENGTH = 500;
// Interligne, comme les calques de texte (lib/pdf/textLayer.ts).
export const THEME_TEXT_LINE_HEIGHT = 1.25;

export const THEME_TEXT_ALIGNS: { value: ThemeTextAlign; label: string }[] = [
  { value: "left", label: "Gauche" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Droite" },
];

let zoneCounter = 0;
export function newThemeTextZone(index: number): ThemeTextZone {
  zoneCounter += 1;
  return {
    id: `texte-${Date.now().toString(36)}-${zoneCounter}`,
    label: `Texte ${index + 1}`,
    defaultText: "Ton texte",
    positionX: 0.5,
    positionY: Math.min(0.9, 0.2 + index * 0.12),
    widthRatio: 0.6,
    heightRatio: 0.1,
    fontId: "inter",
    fontSizeMm: 10,
    bold: false,
    italic: false,
    color: "#000000",
    align: "center",
    maxChars: 0,
    multiline: false,
    uppercase: false,
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// Zone relue d'un formulaire ou de la base : bornée, avec des valeurs sûres.
export function sanitizeTextZone(raw: unknown, index: number): ThemeTextZone | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const widthRatio = clamp(num(r.widthRatio, 0.5), 0.02, 1);
  const heightRatio = clamp(num(r.heightRatio, 0.1), 0.02, 1);
  const color = typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#000000";
  const align: ThemeTextAlign = r.align === "left" || r.align === "right" ? r.align : "center";
  const fontId = FONT_OPTIONS.some((f) => f.id === r.fontId) ? (r.fontId as string) : "inter";
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    id: text(r.id, 60) || `texte-${index + 1}`,
    label: text(r.label, 80).trim() || `Texte ${index + 1}`,
    defaultText: text(r.defaultText, MAX_THEME_TEXT_LENGTH),
    positionX: clamp(num(r.positionX, 0.5), widthRatio / 2, 1 - widthRatio / 2),
    positionY: clamp(num(r.positionY, 0.5), heightRatio / 2, 1 - heightRatio / 2),
    widthRatio,
    heightRatio,
    fontId,
    fontSizeMm: clamp(num(r.fontSizeMm, 10), 1, 500),
    bold: r.bold === true,
    italic: r.italic === true,
    color,
    align,
    maxChars: clamp(Math.round(num(r.maxChars, 0)), 0, MAX_THEME_TEXT_LENGTH),
    multiline: r.multiline === true,
    uppercase: r.uppercase === true,
  };
}

export function sanitizeTextZones(raw: unknown): ThemeTextZone[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_THEME_TEXT_ZONES)
    .map((z, i) => sanitizeTextZone(z, i))
    .filter((z): z is ThemeTextZone => z !== null);
}

// Champ « textZones » de l'éditeur de thème (JSON) ; null si illisible.
export function parseTextZonesField(raw: FormDataEntryValue | null): ThemeTextZone[] | null {
  if (typeof raw !== "string") return null;
  try {
    return sanitizeTextZones(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Texte réellement imprimé dans une zone : celui du client (sinon le texte de
 * départ), ramené aux règles de la zone — longueur, une seule ligne,
 * majuscules.
 */
export function themeZoneText(zone: ThemeTextZone, clientText: string | null | undefined): string {
  let text = typeof clientText === "string" ? clientText : zone.defaultText;
  if (!zone.multiline) text = text.replace(/\s*\n\s*/g, " ");
  const max = zone.maxChars > 0 ? zone.maxChars : MAX_THEME_TEXT_LENGTH;
  text = text.slice(0, max);
  return zone.uppercase ? text.toLocaleUpperCase("fr-CA") : text;
}

// Champ « themeTexts » envoyé par l'outil : un texte par zone, dans l'ordre ;
// null = zone laissée à son texte de départ.
export function parseThemeTextsField(raw: FormDataEntryValue | null): (string | null)[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_THEME_TEXT_ZONES).map((t) => (typeof t === "string" ? t.slice(0, MAX_THEME_TEXT_LENGTH) : null));
  } catch {
    return [];
  }
}

/**
 * Taille de police (px) qui fait tenir le texte dans sa zone : la taille de
 * la zone, réduite au besoin. `lineWidthsAtSize` : la largeur de chaque ligne
 * mesurée à `sizePx` (la mesure dépend de qui dessine : canvas à l'écran,
 * fontkit au serveur).
 */
export function fitThemeTextSize(sizePx: number, lineWidthsAtSize: number[], boxWidthPx: number, boxHeightPx: number): number {
  const widest = Math.max(0, ...lineWidthsAtSize);
  const lines = Math.max(1, lineWidthsAtSize.length);
  const byWidth = widest > 0 ? (sizePx * boxWidthPx) / widest : sizePx;
  const byHeight = boxHeightPx / (lines * THEME_TEXT_LINE_HEIGHT);
  return Math.max(1, Math.min(sizePx, byWidth, byHeight));
}

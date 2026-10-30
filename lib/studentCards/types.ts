// Module Cartes étudiantes : modèles de cartes, zones et données des élèves.
// Types et règles pures, partagés entre l'éditeur (écran) et le rendu PDF
// (serveur). Voir supabase/migrations/0079_student_cards.sql.

import { FONT_OPTIONS, isKnownFontId, sanitizeWeight } from "@/lib/design/fonts";

export type CardSide = "front" | "back";
export const CARD_SIDES: CardSide[] = ["front", "back"];
export const CARD_SIDE_LABELS: Record<CardSide, string> = { front: "Recto", back: "Verso" };

export type CardZoneKind = "text" | "photo" | "barcode" | "image";
export const CARD_ZONE_LABELS: Record<CardZoneKind, string> = {
  text: "Texte",
  photo: "Photo",
  barcode: "Code-barres",
  image: "Image",
};

// Image fixe d'une zone (logo, signature…) : dans le bucket du document, sous
// <id>/images/ (voir lib/variableData/handlers.ts).
export const ZONE_IMAGE_PATH = /^[0-9a-f-]{36}\/images\/[\w-]+\.(png|jpg)$/i;

export type ZoneAlign = "left" | "center" | "right";
export type ZoneRotation = 0 | 90 | 180 | 270;

// Symbologies proposées (noms bwip-js). Codabar : celui de bien des
// bibliothèques scolaires ; Code 128 : le plus courant.
export const BARCODE_TYPES = {
  code128: "Code 128",
  code39: "Code 39",
  rationalizedCodabar: "Codabar",
  interleaved2of5: "Entrelacé 2 de 5",
  ean13: "EAN-13",
  qrcode: "QR code",
  datamatrix: "Data Matrix",
  pdf417: "PDF417",
} as const;
export type BarcodeType = keyof typeof BARCODE_TYPES;
export const TWO_D_BARCODES: BarcodeType[] = ["qrcode", "datamatrix", "pdf417"];

export function isBarcodeType(value: unknown): value is BarcodeType {
  return typeof value === "string" && value in BARCODE_TYPES;
}

// Une zone de la carte : un rectangle en mm depuis le coin haut-gauche de la
// face, qui reçoit un texte, la photo de l'élève ou un code-barres.
export interface CardZone {
  id: string;
  side: CardSide;
  kind: CardZoneKind;
  x: number;
  y: number;
  width: number;
  height: number;
  // Rotation du contenu dans la zone (sens horaire).
  rotation: ZoneRotation;
  // Texte et code-barres : le contenu, avec les colonnes du CSV entre
  // accolades (« {Prénom} {Nom} », « {Numéro} »). Du texte fixe est permis.
  content: string;
  // Texte
  fontId: string;
  bold: boolean;
  // Graisse choisie (100 à 900, voir fontWeight dans lib/design/fonts.ts).
  // Absente = `bold` décide (gras ou normal), comme avant.
  weight?: number;
  uppercase: boolean;
  color: string; // #rrggbb
  align: ZoneAlign;
  maxFontMm: number;
  // Code-barres
  barcodeType: BarcodeType;
  showText: boolean;
  // Image fixe : le fichier, et comment il remplit la zone (entière, ou
  // recadrée pour la couvrir).
  imagePath: string | null;
  fit: "contain" | "cover";
  // Photo : masque facultatif (SVG ou PNG converti, même dossier que les
  // images fixes). La photo ne paraît que là où le masque est opaque ; il est
  // posé entier et centré dans la zone, hors du masque la photo disparaît.
  maskPath: string | null;
}

// Colonnes et une ligne du dernier CSV : l'éditeur montre l'aperçu sans qu'on
// recharge le fichier.
export interface CardSample {
  columns: string[];
  row: Record<string, string>;
}

export interface StudentCardTemplate {
  id: string;
  name: string;
  school: string;
  width_mm: number;
  height_mm: number;
  two_sided: boolean;
  front_path: string | null;
  back_path: string | null;
  zones: CardZone[];
  sample: CardSample | null;
  photo_column: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// Ce qu'il faut au rendu d'une page à données variables : son format (fond
// perdu compris, s'il y en a), ses faces et ses zones. Une carte étudiante
// comme un gabarit bâti sur un modèle (voir 0080_data_templates.sql).
export type VariableDataPage = Pick<StudentCardTemplate, "width_mm" | "height_mm" | "two_sided" | "zones">;

// Mots de l'interface selon le document : des élèves et des cartes, ou des
// lignes et des pages (un gabarit à données variables).
export interface DataVocab {
  row: string;
  rows: string;
  Row: string;
  page: string;
  pages: string;
}
export const STUDENT_VOCAB: DataVocab = { row: "élève", rows: "élèves", Row: "Élève", page: "carte", pages: "cartes" };
export const DATA_VOCAB: DataVocab = { row: "ligne", rows: "lignes", Row: "Ligne", page: "page", pages: "pages" };

// Formats proposés à la création : la carte de crédit (CR80), à l'horizontale
// ou à la verticale.
export const CARD_FORMATS = [
  { label: "CR80 horizontale (85,6 × 54 mm)", width: 85.6, height: 54 },
  { label: "CR80 verticale (54 × 85,6 mm)", width: 54, height: 85.6 },
] as const;

export const MIN_FONT_MM = 1.2;

// Clé de comparaison d'un nom de colonne ou de fichier : sans accents, sans
// casse, espaces resserrés.
export function looseKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Valeur d'une colonne dans une ligne, nom de colonne comparé sans accents ni casse.
export function columnValue(row: Record<string, string>, column: string): string {
  if (column in row) return row[column] ?? "";
  const key = looseKey(column);
  const found = Object.keys(row).find((c) => looseKey(c) === key);
  return found ? row[found] ?? "" : "";
}

// « {Prénom} {Nom} » → « Léa Tremblay ». Espaces resserrés : une colonne vide
// ne laisse pas de trou.
export function fillContent(content: string, row: Record<string, string>): string {
  return content
    .replace(/\{([^{}]+)\}/g, (_, column: string) => columnValue(row, column.trim()))
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Colonnes citées par un contenu.
export function contentColumns(content: string): string[] {
  return Array.from(content.matchAll(/\{([^{}]+)\}/g), (m) => m[1].trim());
}

/**
 * Taille du texte (mm) dans une zone : la plus grande qui tienne, sans
 * dépasser maxFontMm. Sans marge intérieure : aligné à gauche ou à droite, le
 * texte touche le bord de la zone. `inkWidthPerMm` : largeur du dessin des
 * lettres pour 1 mm de corps (sans l'approche de la première et de la
 * dernière), `heightPerMm` : hauteur ascendante → descendante.
 */
export function fitCardFontMm(zone: CardZone, inkWidthPerMm: number, heightPerMm: number): number {
  const turned = zone.rotation % 180 !== 0;
  const boxW = turned ? zone.height : zone.width;
  const boxH = turned ? zone.width : zone.height;
  const byWidth = inkWidthPerMm > 0 ? boxW / inkWidthPerMm : zone.maxFontMm;
  const byHeight = heightPerMm > 0 ? boxH / heightPerMm : zone.maxFontMm;
  return Math.max(MIN_FONT_MM, Math.min(zone.maxFontMm, byWidth, byHeight));
}

export function zoneText(zone: CardZone, row: Record<string, string>): string {
  const text = fillContent(zone.content, row);
  return zone.uppercase ? text.toLocaleUpperCase("fr-CA") : text;
}

let zoneCounter = 0;
export function newCardZone(partial: Partial<CardZone> = {}): CardZone {
  zoneCounter += 1;
  return {
    id: `zone-${Date.now().toString(36)}-${zoneCounter}`,
    side: "front",
    kind: "text",
    x: 5,
    y: 5,
    width: 30,
    height: 6,
    rotation: 0,
    content: "",
    fontId: FONT_OPTIONS[0].id,
    bold: false,
    uppercase: false,
    color: "#1a1613",
    align: "left",
    maxFontMm: 4,
    barcodeType: "code128",
    showText: true,
    imagePath: null,
    fit: "contain",
    maskPath: null,
    ...partial,
  };
}

// Zones reçues d'un formulaire : tout est revérifié, rien n'est pris tel quel.
export function parseCardZones(raw: unknown, cardW: number, cardH: number): CardZone[] | null {
  if (!Array.isArray(raw) || raw.length > 100) return null;
  const zones: CardZone[] = [];
  for (const z of raw as Record<string, unknown>[]) {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const x = n(z.x), y = n(z.y), w = n(z.width), h = n(z.height), max = n(z.maxFontMm);
    if (![x, y, w, h].every((v) => !Number.isNaN(v))) return null;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > cardW + 0.01 || y + h > cardH + 0.01) return null;
    const kind: CardZoneKind = z.kind === "photo" || z.kind === "barcode" || z.kind === "image" ? z.kind : "text";
    zones.push({
      id: typeof z.id === "string" && z.id.length <= 64 ? z.id : `zone-${zones.length + 1}`,
      side: z.side === "back" ? "back" : "front",
      kind,
      x, y, width: w, height: h,
      rotation: [0, 90, 180, 270].includes(Number(z.rotation)) ? (Number(z.rotation) as ZoneRotation) : 0,
      content: typeof z.content === "string" ? z.content.slice(0, 500) : "",
      fontId: isKnownFontId(z.fontId) ? z.fontId : FONT_OPTIONS[0].id,
      bold: z.bold === true,
      ...(sanitizeWeight(z.weight) ? { weight: sanitizeWeight(z.weight) } : {}),
      uppercase: z.uppercase === true,
      color: typeof z.color === "string" && /^#[0-9a-f]{6}$/i.test(z.color) ? z.color : "#1a1613",
      align: z.align === "center" || z.align === "right" ? z.align : "left",
      maxFontMm: Number.isNaN(max) ? 4 : Math.min(50, Math.max(MIN_FONT_MM, max)),
      barcodeType: isBarcodeType(z.barcodeType) ? z.barcodeType : "code128",
      showText: z.showText !== false,
      imagePath: kind === "image" && typeof z.imagePath === "string" && ZONE_IMAGE_PATH.test(z.imagePath) ? z.imagePath : null,
      fit: z.fit === "cover" ? "cover" : "contain",
      maskPath: kind === "photo" && typeof z.maskPath === "string" && ZONE_IMAGE_PATH.test(z.maskPath) ? z.maskPath : null,
    });
  }
  return zones;
}

export function parseCardSample(raw: unknown): CardSample | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { columns?: unknown; row?: unknown };
  if (!Array.isArray(r.columns)) return null;
  const columns = r.columns.filter((c): c is string => typeof c === "string").slice(0, 100).map((c) => c.slice(0, 100));
  const row: Record<string, string> = {};
  if (r.row && typeof r.row === "object") {
    for (const c of columns) {
      const v = (r.row as Record<string, unknown>)[c];
      row[c] = typeof v === "string" ? v.slice(0, 300) : "";
    }
  }
  return { columns, row };
}

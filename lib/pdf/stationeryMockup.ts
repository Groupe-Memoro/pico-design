import sharp from "sharp";
import { mmToPx } from "./units";
import { coverCropToBuffer } from "./crop";
import { logoOverlay } from "./logoShadow";
import { compositeLayers, type ResolvedLayer } from "./layers";
import type { LogoShadowSettings } from "../logoShadowSettings";
import type { Template } from "../types";

const MOCKUP_MAX_DIM_PX = 1200;

// Ombre "carte posée à plat" — fixe, indépendante des réglages d'ombre du
// logo (propres à chaque produit) : ce mockup n'en a qu'une seule, pensée
// pour ce rendu précis (portée franchement vers le bas, assez douce).
const CARD_SHADOW: LogoShadowSettings = { blur: 3, distance: 2.5, angle: 90, opacity: 30 };

// Marge (autour de la carte, dans le canevas) en fraction de sa largeur —
// assez généreuse pour que l'ombre (voir CARD_SHADOW) ne soit jamais coupée.
const CANVAS_MARGIN_RATIO = 0.14;

export interface StationeryMockupInput {
  // Modèle déjà orienté (voir applyOrientation).
  template: Template;
  // null = pas de visuel de fond choisi (voir coverCropToBuffer) — un
  // montage fait seulement de calques reste possible.
  image: Buffer | null;
  positionX: number;
  positionY: number;
  zoom: number;
  // Rotation du visuel lui-même (0/90/180/270) — voir coverCropToBuffer.
  rotation?: number;
  // Calques additionnels (texte/image) de ce côté, dans l'ordre d'empilement.
  layers?: ResolvedLayer[];
  // Le côté seul, au format fini, sans ombre ni marge : la matière de
  // le mockup d'un produit plié (foldedMockup.ts), qui le découpe en volets.
  flat?: boolean;
  // Plus grand côté du rendu, en pixels (1200 par défaut) : le mockup d'un
  // dépliant (voir foldedMockup.ts) en veut plus, ses volets étant agrandis.
  maxDimPx?: number;
}

/**
 * Mockup générique pour les modèles sans bundle "beauty shot" ni
 * masque/ombrage dédié (typiquement la papeterie : cartes, cartes postales,
 * signets... — voir /api/design/mockup, qui l'utilise en repli). Pas un
 * rendu réaliste sur un produit physique comme
 * `generateProductMockupPng`/`generateBeautyShotMockupPng` : juste **un**
 * côté du visuel (recto ou verso — l'appelant fait un rendu par côté, voir
 * /api/design/mockup) à sa dimension **finale** — fond perdu retiré,
 * puisqu'après la coupe il n'apparaît plus sur le produit fini,
 * contrairement au PDF d'impression qui travaille toujours page + fond
 * perdu — avec une ombre portée, pour donner un aperçu "carte posée à
 * plat" plutôt qu'un simple rectangle plein cadre.
 */
export async function generateStationeryMockupPng({
  template,
  image,
  positionX,
  positionY,
  zoom,
  rotation = 0,
  layers = [],
  flat = false,
  maxDimPx = MOCKUP_MAX_DIM_PX,
}: StationeryMockupInput): Promise<Buffer> {
  // Résolution plafonnée (mockup à l'écran, pas un fichier d'impression) —
  // même logique que generateProductMockupPng.
  const fullWidthPx = mmToPx(template.width_mm, template.dpi);
  const fullHeightPx = mmToPx(template.height_mm, template.dpi);
  const scale = Math.min(1, maxDimPx / Math.max(fullWidthPx, fullHeightPx, 1));
  const dpi = template.dpi * scale;
  const cardWidthPx = Math.max(1, Math.round(mmToPx(template.width_mm, dpi)));
  const cardHeightPx = Math.max(1, Math.round(mmToPx(template.height_mm, dpi)));

  // Cadré sur la dimension finale (sans fond perdu) : c'est la différence
  // clé avec le recadrage du PDF, qui inclut toujours le fond perdu.
  const cropped = await coverCropToBuffer(image, cardWidthPx, cardHeightPx, positionX, positionY, zoom, rotation);
  const withLayers = await compositeLayers(cropped, layers, cardWidthPx, cardHeightPx, dpi);
  if (flat) return sharp(withLayers).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  // `ensureAlpha` : la silhouette que l'ombre portée dessine vient du canal
  // alpha (voir addDropShadow) — sans lui, une image sans transparence (le
  // cas courant ici) ne projetterait aucune ombre.
  const card = await sharp(withLayers).ensureAlpha().png().toBuffer();

  const marginPx = Math.round(cardWidthPx * CANVAS_MARGIN_RATIO);
  const canvasWidth = cardWidthPx + marginPx * 2;
  const canvasHeight = cardHeightPx + marginPx * 2;
  const overlay = await logoOverlay(card, CARD_SHADOW, marginPx, marginPx, canvasWidth, canvasHeight);

  return sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .composite([overlay])
    .png()
    .toBuffer();
}

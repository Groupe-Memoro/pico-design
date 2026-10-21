import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { DEFAULT_LOGO_SHADOW, type LogoShadowSettings } from "../logoShadowSettings";

// Les réglages de l'ombre (flou, distance, angle, opacité) viennent du produit,
// voir lib/logoShadowSettings.ts ; flou et distance sont proportionnels à la
// largeur du logo pour que l'ombre ait la même allure à toutes les tailles.

export interface ShadowedLogo {
  // Le logo sur son ombre, sur un canevas agrandi de `pad` pixels de chaque côté.
  png: Buffer;
  pad: number;
}

/**
 * Ajoute une ombre portée (noire, floue, décalée selon `settings`) à un logo
 * PNG à fond transparent. Le logo lui-même n'est ni déplacé
 * ni redimensionné : seule la marge `pad` est ajoutée autour pour que l'ombre
 * ne soit pas coupée — l'appelant doit décaler la position de `pad` pixels
 * vers le haut/la gauche pour que le logo reste exactement à sa place.
 */
export async function addDropShadow(
  logoPng: Buffer,
  settings: LogoShadowSettings = DEFAULT_LOGO_SHADOW
): Promise<ShadowedLogo> {
  const { width = 1, height = 1 } = await sharp(logoPng).metadata();
  // sharp n'accepte pas un flou sous 0,3 : en dessous, l'ombre est nette.
  const sigma = (width * settings.blur) / 100;
  const blurred = sigma >= 0.3;
  const distancePx = (width * settings.distance) / 100;
  const radians = (settings.angle * Math.PI) / 180;
  const dx = Math.round(distancePx * Math.cos(radians));
  const dy = Math.round(distancePx * Math.sin(radians));
  // Le flou s'étend sur ~3 écarts-types, en plus du décalage (dans les deux sens).
  const pad = Math.ceil((blurred ? sigma * 3 : 0) + Math.max(Math.abs(dx), Math.abs(dy))) + 1;
  const canvasWidth = width + pad * 2;
  const canvasHeight = height + pad * 2;

  // Silhouette noire du logo, à l'opacité voulue (on ne touche qu'au canal alpha).
  const silhouette = await sharp(logoPng)
    .ensureAlpha()
    .linear([0, 0, 0, settings.opacity / 100], [0, 0, 0, 0])
    .png()
    .toBuffer();

  const offsetSilhouette = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: silhouette, left: pad + dx, top: pad + dy }])
    .png()
    .toBuffer();

  // Le flou est appliqué dans une étape séparée : sharp exécute `composite`
  // après ses autres opérations, un `blur` chaîné ne flouterait pas la silhouette.
  const softShadow = blurred ? await sharp(offsetSilhouette).blur(sigma).png().toBuffer() : offsetSilhouette;

  const png = await sharp(softShadow)
    .composite([{ input: logoPng, left: pad, top: pad }])
    .png()
    .toBuffer();
  return { png, pad };
}

/**
 * Prépare le calque « logo » d'un `composite` sharp, avec ou sans ombre
 * (`shadow` null = sans).
 * `left`/`top` sont la position du logo lui-même sur le canevas de taille
 * `canvasWidth × canvasHeight` ; avec l'ombre, l'image est agrandie de sa
 * marge puis rognée à ce qui reste dans le canevas (sharp refuse un calque
 * qui dépasse).
 */
export async function logoOverlay(
  logoPng: Buffer,
  shadow: LogoShadowSettings | null,
  left: number,
  top: number,
  canvasWidth: number,
  canvasHeight: number
): Promise<OverlayOptions> {
  if (!shadow) return { input: logoPng, left, top };

  const { png, pad } = await addDropShadow(logoPng, shadow);
  const { width = 1, height = 1 } = await sharp(png).metadata();
  const x = left - pad;
  const y = top - pad;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(canvasWidth, x + width);
  const y1 = Math.min(canvasHeight, y + height);
  if (x0 === x && y0 === y && x1 === x + width && y1 === y + height) {
    return { input: png, left: x, top: y };
  }
  const cropped = await sharp(png)
    .extract({ left: x0 - x, top: y0 - y, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer();
  return { input: cropped, left: x0, top: y0 };
}

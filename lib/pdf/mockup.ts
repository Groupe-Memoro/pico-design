import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { mmToPx } from "./units";
import { coverCropToBuffer } from "./crop";
import { rasterizeLogoToPng } from "./logo";
import { logoOverlay } from "./logoShadow";
import { compositeLayers, type ResolvedLayer } from "./layers";
import type { LogoShadowSettings } from "../logoShadowSettings";
import type { Template } from "../types";

const MOCKUP_MAX_DIM_PX = 1400;

/**
 * Compose un aperçu "mockup" réaliste d'un produit : le visuel imprimé
 * (recadré et avec le logo, comme sur le PDF final), découpé à la forme du
 * masque du modèle (sa transparence définit la partie qui reste visible),
 * puis l'ombrage du modèle superposé par-dessus pour donner du relief (ex.
 * un étui de téléphone). Le masque et l'ombrage sont supposés dessinés pour
 * la zone de coupe du modèle (même ratio) — ils sont mis à sa taille exacte.
 */
export async function generateProductMockupPng(
  template: Template,
  // null = pas de visuel de fond choisi (voir coverCropToBuffer) — un
  // montage fait seulement de calques reste possible.
  sourceImage: Buffer | null,
  maskImage: Buffer,
  shadingImage: Buffer,
  logoImage: Buffer | null,
  positionX = 0.5,
  positionY = 0.5,
  logoShadow: LogoShadowSettings | null = null,
  // Zoom (recadrage) au-delà du minimum "cover" — voir coverCropToBuffer.
  // 1 = comportement d'origine (aucun appelant existant n'en envoie).
  zoom = 1,
  // Rotation du visuel lui-même (0/90/180/270) — voir coverCropToBuffer.
  imageRotation = 0,
  layers: ResolvedLayer[] = []
): Promise<Buffer> {
  const pageWidthMm = template.width_mm + template.bleed_mm * 2;
  const pageHeightMm = template.height_mm + template.bleed_mm * 2;
  const fullWidthPx = mmToPx(pageWidthMm, template.dpi);
  const fullHeightPx = mmToPx(pageHeightMm, template.dpi);
  const scale = Math.min(1, MOCKUP_MAX_DIM_PX / Math.max(fullWidthPx, fullHeightPx, 1));
  const dpi = template.dpi * scale;

  const pageWidthPx = Math.max(1, Math.round(mmToPx(pageWidthMm, dpi)));
  const pageHeightPx = Math.max(1, Math.round(mmToPx(pageHeightMm, dpi)));
  const bleedPx = Math.round(mmToPx(template.bleed_mm, dpi));
  const trimWidthPx = Math.max(1, pageWidthPx - bleedPx * 2);
  const trimHeightPx = Math.max(1, pageHeightPx - bleedPx * 2);

  const covered = await coverCropToBuffer(
    sourceImage,
    pageWidthPx,
    pageHeightPx,
    positionX,
    positionY,
    zoom,
    imageRotation
  );

  const composites: OverlayOptions[] = [];
  if (logoImage && template.logo_width_mm > 0) {
    const logoWidthPx = Math.max(1, Math.round(mmToPx(template.logo_width_mm, dpi)));
    const rawLogoPng = await rasterizeLogoToPng(logoImage, logoWidthPx);
    const meta = await sharp(rawLogoPng).metadata();
    const nativeW = meta.width ?? logoWidthPx;
    const nativeH = meta.height ?? logoWidthPx;
    const logoHeightPx = Math.max(1, Math.round(nativeH * (logoWidthPx / nativeW)));
    const logoPng = await sharp(rawLogoPng).resize(logoWidthPx, logoHeightPx).png().toBuffer();

    const marginXPx = mmToPx(template.logo_margin_x_mm + template.bleed_mm, dpi);
    const marginYPx = mmToPx(template.logo_margin_y_mm + template.bleed_mm, dpi);
    const left =
      template.logo_h_align === "left"
        ? marginXPx
        : template.logo_h_align === "right"
        ? pageWidthPx - marginXPx - logoWidthPx
        : (pageWidthPx - logoWidthPx) / 2;
    const top = template.logo_v_align === "top" ? marginYPx : pageHeightPx - marginYPx - logoHeightPx;

    composites.push(
      await logoOverlay(
        logoPng,
        logoShadow,
        Math.round(Math.min(Math.max(left, 0), Math.max(pageWidthPx - logoWidthPx, 0))),
        Math.round(Math.min(Math.max(top, 0), Math.max(pageHeightPx - logoHeightPx, 0))),
        pageWidthPx,
        pageHeightPx
      )
    );
  }

  const withLayers = await compositeLayers(covered, layers, pageWidthPx, pageHeightPx, dpi);
  const flatPage = await sharp(withLayers)
    .flatten({ background: "#ffffff" })
    .composite(composites)
    .png()
    .toBuffer();

  // Le fond perdu est coupé à l'impression : seule la zone de coupe reste
  // visible sur le produit fini, donc sur le mockup.
  const design = await sharp(flatPage)
    .extract({ left: bleedPx, top: bleedPx, width: trimWidthPx, height: trimHeightPx })
    .ensureAlpha()
    .toBuffer();

  const maskResized = await sharp(maskImage)
    .resize(trimWidthPx, trimHeightPx, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const shadingResized = await sharp(shadingImage)
    .resize(trimWidthPx, trimHeightPx, { fit: "fill" })
    .png()
    .toBuffer();

  const masked = await sharp(design)
    .composite([{ input: maskResized, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(masked)
    .composite([{ input: shadingResized }])
    .png()
    .toBuffer();
}

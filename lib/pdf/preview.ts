import sharp from "sharp";
import { foldAxisLength, foldPanels, parseFold } from "../folds";
import { mmToPx } from "./units";
import { rasterizeLogoToPng, isSvg } from "./logo";
import { logoOverlay } from "./logoShadow";
import { EXAMPLE_LABEL } from "./exampleLabel";
import { coverCropToBuffer } from "./crop";
import type { Template } from "../types";
import type { LogoShadowSettings } from "../logoShadowSettings";

const PREVIEW_MAX_DIM_PX = 900;

/**
 * Génère un aperçu PNG d'un modèle : la page (avec la ligne de coupe si
 * fond perdu) et le logo Pico positionné exactement comme sur le PDF final.
 * Si `sourceImage` est fourni (aperçu d'un produit avant enregistrement),
 * il est recadré en "cover" pour remplir la page, comme le fera la
 * génération de PDF réelle ; sinon un fond neutre "Exemple" est utilisé.
 * `overlayImage`, si fourni, est un gabarit de guidage (ex. position des
 * caméras) plaqué sur la zone de coupe finie — uniquement pour l'aperçu,
 * jamais inclus dans le PDF imprimé (voir lib/pdf/generate.ts).
 *
 * `transparent`, si vrai, ignore `sourceImage` et rend uniquement le
 * "cadre" (ligne de coupe, marge de sécurité, gabarit, logo) sur fond
 * transparent — utilisé côté client comme calque fixe pendant que l'image
 * de fond est déplacée séparément pour le repositionnement.
 *
 * `guides`, si faux, omet la ligne de coupe/marge de sécurité et le gabarit
 * de guidage (`overlayImage`) quand `sourceImage` est fourni — image + logo
 * seuls, pour un livrable final (ex. téléchargement dans Design Shopify)
 * plutôt qu'un aperçu de travail. Sans effet en mode `transparent` (le
 * "cadre" y est justement le contenu demandé).
 *
 * `zoom` (1 = pas de zoom, voir coverCropToBuffer) resserre le cadrage de
 * `sourceImage` — utilisé par l'étape « Aperçu » de Design Shopify.
 */
export async function generateTemplatePreviewPng(
  template: Template,
  logoImage: Buffer | null,
  sourceImage?: Buffer | null,
  overlayImage?: Buffer | null,
  positionX = 0.5,
  positionY = 0.5,
  transparent = false,
  logoShadow: LogoShadowSettings | null = null,
  guides = true,
  zoom = 1,
  // Côté montré : les volets d'un produit plié n'y sont pas au même endroit.
  side: "front" | "back" = "front"
): Promise<Buffer> {
  const pageWidthMm = template.width_mm + template.bleed_mm * 2;
  const pageHeightMm = template.height_mm + template.bleed_mm * 2;

  const fullWidthPx = mmToPx(pageWidthMm, template.dpi);
  const fullHeightPx = mmToPx(pageHeightMm, template.dpi);
  const scale = Math.min(1, PREVIEW_MAX_DIM_PX / Math.max(fullWidthPx, fullHeightPx, 1));
  const previewDpi = template.dpi * scale;

  const pageWidthPx = Math.max(1, Math.round(mmToPx(pageWidthMm, previewDpi)));
  const pageHeightPx = Math.max(1, Math.round(mmToPx(pageHeightMm, previewDpi)));
  const bleedPx = mmToPx(template.bleed_mm, previewDpi);

  const trimX = bleedPx;
  const trimY = bleedPx;
  const trimW = Math.max(0, pageWidthPx - bleedPx * 2);
  const trimH = Math.max(0, pageHeightPx - bleedPx * 2);

  const safetyXPx = mmToPx(template.safety_margin_x_mm, previewDpi);
  const safetyYPx = mmToPx(template.safety_margin_y_mm, previewDpi);
  const safetyX = trimX + safetyXPx;
  const safetyY = trimY + safetyYPx;
  const safetyW = Math.max(0, trimW - safetyXPx * 2);
  const safetyH = Math.max(0, trimH - safetyYPx * 2);

  const showPlaceholder = !sourceImage && !transparent;
  // Un gabarit de guidage remplace les marques de coupe/sécurité dans
  // l'aperçu — il apporte déjà ses propres repères, les deux ensemble
  // seraient redondants/confus.
  const hasOverlay = Boolean(overlayImage);

  // Marques de pli : lignes complètes (traversent toute la page), une par
  // distance enregistrée (depuis le bord de coupe) — "vertical" = ligne
  // verticale (divise la largeur), "horizontal" = ligne horizontale (divise
  // la hauteur). Aperçu écran seulement, jamais dans le PDF imprimé (voir
  // generatePrintReadyPdf, qui n'en tient pas compte) — comme la ligne de
  // coupe/marge de sécurité, masquées avec elles par un gabarit de guidage.
  // Un produit plié (template.fold) trace ses propres plis plus bas : les
  // marques manuelles feraient doublon, souvent décalées d'un millimètre.
  const fold = parseFold(template.fold);
  const foldMarksLinesSvg = hasOverlay || fold
    ? ""
    : [
        ...(template.fold_marks_vertical_mm ?? []).map((mm) => {
          const x = trimX + mmToPx(mm, previewDpi);
          return `<line x1="${x}" y1="0" x2="${x}" y2="${pageHeightPx}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="6 3"/>`;
        }),
        ...(template.fold_marks_horizontal_mm ?? []).map((mm) => {
          const y = trimY + mmToPx(mm, previewDpi);
          return `<line x1="0" y1="${y}" x2="${pageWidthPx}" y2="${y}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="6 3"/>`;
        }),
      ].join("\n");

  // Produit plié : chaque pli et une zone de sécurité de part et d'autre (voir
  // lib/folds.ts). Écran seulement ; le nom des volets s'affiche hors du
  // visuel, dans l'aperçu (ImageSourcePicker).
  let foldSvg = "";
  if (fold && !hasOverlay) {
    const vertical = fold.direction === "vertical";
    const length = foldAxisLength(fold, template.width_mm, template.height_mm);
    const panels = foldPanels(fold, length, side);
    const safetyPx = mmToPx(fold.safetyMm, previewDpi);
    foldSvg = panels
      .map((panel, i) => {
        const start = mmToPx(panel.start, previewDpi);
        const parts: string[] = [];
        if (i > 0) {
          if (vertical) {
            const x = trimX + start;
            parts.push(
              `<rect x="${x - safetyPx}" y="${trimY}" width="${safetyPx * 2}" height="${trimH}" fill="#ef4444" fill-opacity="0.12"/>`,
              `<line x1="${x}" y1="0" x2="${x}" y2="${pageHeightPx}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="6 3"/>`
            );
          } else {
            const y = trimY + start;
            parts.push(
              `<rect x="${trimX}" y="${y - safetyPx}" width="${trimW}" height="${safetyPx * 2}" fill="#ef4444" fill-opacity="0.12"/>`,
              `<line x1="0" y1="${y}" x2="${pageWidthPx}" y2="${y}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="6 3"/>`
            );
          }
        }
        return parts.join("\n");
      })
      .join("\n");
  }

  const linesSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${pageWidthPx}" height="${pageHeightPx}">
      ${showPlaceholder ? `<rect width="100%" height="100%" fill="#ffffff"/>` : ""}
      ${
        template.bleed_mm > 0 && !hasOverlay
          ? `<rect x="${trimX}" y="${trimY}" width="${trimW}" height="${trimH}" fill="none" stroke="#ff00ff" stroke-width="1.5"/>`
          : ""
      }
      ${
        (template.safety_margin_x_mm > 0 || template.safety_margin_y_mm > 0) && !hasOverlay
          ? `<rect x="${safetyX}" y="${safetyY}" width="${safetyW}" height="${safetyH}" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="3 3"/>`
          : ""
      }
      ${foldMarksLinesSvg}
      ${foldSvg}
    </svg>
  `;

  let base: Buffer;
  const composites: sharp.OverlayOptions[] = [];

  if (transparent) {
    base = await sharp({
      create: { width: pageWidthPx, height: pageHeightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    composites.push({ input: await sharp(Buffer.from(linesSvg)).png().toBuffer(), left: 0, top: 0 });
  } else if (sourceImage) {
    base = await sharp(await coverCropToBuffer(sourceImage, pageWidthPx, pageHeightPx, positionX, positionY, zoom))
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    if (guides) {
      composites.push({ input: await sharp(Buffer.from(linesSvg)).png().toBuffer(), left: 0, top: 0 });
    }
  } else {
    base = await sharp(Buffer.from(linesSvg)).png().toBuffer();
  }

  if (showPlaceholder) {
    // « Exemple » au centre, en image (pas de texte SVG : voir exampleLabel.ts).
    const labelWidthPx = Math.min(
      pageWidthPx,
      Math.max(40, Math.round(Math.max(14, pageWidthPx * 0.06) * 3.5))
    );
    const labelHeightPx = Math.max(1, Math.round((labelWidthPx * EXAMPLE_LABEL.height) / EXAMPLE_LABEL.width));
    composites.push({
      input: await sharp(EXAMPLE_LABEL.png).resize(labelWidthPx, labelHeightPx).png().toBuffer(),
      left: Math.max(0, Math.round((pageWidthPx - labelWidthPx) / 2)),
      top: Math.max(0, Math.round((pageHeightPx - labelHeightPx) / 2)),
    });
  }

  if (guides && overlayImage && trimW > 0 && trimH > 0) {
    // Le gabarit garde sa taille réelle : ses pixels natifs sont considérés
    // comme exportés à la résolution du modèle (template.dpi), donc mis à
    // l'échelle uniquement par le même facteur que le reste de l'aperçu
    // (`scale`) — jamais étiré/rétréci pour remplir la zone de coupe.
    // Centré horizontalement et verticalement sur cette zone.
    const overlaySharp = isSvg(overlayImage)
      ? sharp(overlayImage, { density: template.dpi })
      : sharp(overlayImage);
    const overlayMeta = await overlaySharp.metadata();
    const nativeW = overlayMeta.width ?? trimW;
    const nativeH = overlayMeta.height ?? trimH;
    const rawDisplayW = Math.max(1, Math.round(nativeW * scale));
    const rawDisplayH = Math.max(1, Math.round(nativeH * scale));

    // Ne jamais dépasser la page complète (sharp refuse un composite plus
    // grand que le calque de base) — repli rare, ratio préservé.
    const overshootScale = Math.min(1, pageWidthPx / rawDisplayW, pageHeightPx / rawDisplayH);
    const displayW = Math.max(1, Math.round(rawDisplayW * overshootScale));
    const displayH = Math.max(1, Math.round(rawDisplayH * overshootScale));

    const overlayPng = await overlaySharp.resize(displayW, displayH, { fit: "fill" }).png().toBuffer();
    const left = Math.round(
      Math.max(0, Math.min(trimX + (trimW - displayW) / 2, pageWidthPx - displayW))
    );
    const top = Math.round(
      Math.max(0, Math.min(trimY + (trimH - displayH) / 2, pageHeightPx - displayH))
    );
    composites.push({ input: overlayPng, left, top });
  }

  if (logoImage && template.logo_width_mm > 0) {
    const logoWidthPx = Math.max(1, Math.round(mmToPx(template.logo_width_mm, previewDpi)));
    const rawLogoPng = await rasterizeLogoToPng(logoImage, logoWidthPx);
    const meta = await sharp(rawLogoPng).metadata();
    const nativeW = meta.width ?? logoWidthPx;
    const nativeH = meta.height ?? logoWidthPx;
    const logoHeightPx = Math.max(1, Math.round(nativeH * (logoWidthPx / nativeW)));
    const logoPng = await sharp(rawLogoPng).resize(logoWidthPx, logoHeightPx).png().toBuffer();

    const marginXPx = mmToPx(template.logo_margin_x_mm + template.bleed_mm, previewDpi);
    const marginYPx = mmToPx(template.logo_margin_y_mm + template.bleed_mm, previewDpi);

    const left =
      template.logo_h_align === "left"
        ? marginXPx
        : template.logo_h_align === "right"
        ? pageWidthPx - marginXPx - logoWidthPx
        : (pageWidthPx - logoWidthPx) / 2;

    // Contrairement au PDF (origine en bas), l'image raster a son origine
    // en haut : "top" correspond donc directement à la petite marge, sans
    // inversion.
    const top =
      template.logo_v_align === "top" ? marginYPx : pageHeightPx - marginYPx - logoHeightPx;

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

  return sharp(base).composite(composites).png().toBuffer();
}

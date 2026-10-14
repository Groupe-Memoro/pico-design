import sharp from "sharp";
import { coverCropToBuffer } from "./crop";
import type { ThemeSlot, ThemeSlotAdjust } from "../types";
import { MAX_THEME_SLOTS, maskSvgSized, sanitizeSlotShape, slotShape, slotSvgShape } from "../themeShapes";

const DEFAULT_ADJUST: ThemeSlotAdjust = { positionX: 0.5, positionY: 0.5, scale: 1 };

/**
 * Compose le rendu d'un Thème : chaque photo du client est recadrée en
 * "cover" pour remplir exactement son emplacement (voir ThemeSlot — même
 * convention que ShapeLayer : positionX/Y = centre, widthRatio/heightRatio
 * relatifs à la page), déplacée/zoomée dans ce rectangle selon l'ajustement
 * du client (`slotAdjust[i]`, voir ThemeSlotAdjust — même mécanique que
 * positionX/positionY/scale pour un fond simple, voir coverCropToBuffer),
 * découpée selon la forme de l'emplacement (rectangle, ovale ou polygone,
 * voir lib/themeShapes.ts), sur l'image de fond du thème (`backgroundImage`,
 * étirée à la page) ou à défaut un fond blanc, puis le graphisme du thème
 * (`overlayImage`, avec transparence) est posé par-dessus — ses zones
 * opaques (cadre, décor) restent visibles, ses zones transparentes laissent
 * voir les photos en dessous.
 *
 * Un emplacement sans photo (`slotFiles[i]` null) laisse voir le fond à
 * cet endroit — comme un fond absent ailleurs dans l'app (voir
 * coverCropToBuffer) : permet de prévisualiser/imprimer un thème même
 * partiellement rempli.
 */
export async function composeThemeImage(
  slotFiles: (Buffer | null)[],
  slots: ThemeSlot[],
  overlayImage: Buffer,
  targetWidthPx: number,
  targetHeightPx: number,
  slotAdjust: (ThemeSlotAdjust | null | undefined)[] = [],
  backgroundImage: Buffer | null = null
): Promise<Buffer> {
  const composites: sharp.OverlayOptions[] = [];

  if (backgroundImage) {
    const backgroundResized = await sharp(backgroundImage)
      .resize(targetWidthPx, targetHeightPx, { fit: "fill" })
      .png()
      .toBuffer();
    composites.push({ input: backgroundResized, left: 0, top: 0 });
  }

  for (let i = 0; i < slots.length; i++) {
    const file = slotFiles[i] ?? null;
    if (!file) continue;
    const slot = slots[i];
    const adjust = slotAdjust[i] ?? DEFAULT_ADJUST;
    // Bornés à la taille de la page (au cas où) : l'éditeur admin contraint
    // déjà chaque emplacement à rester dans la page, mais sharp refuse un
    // composite qui déborderait de son fond — filet de sécurité plutôt
    // qu'une confiance aveugle dans les données enregistrées.
    const widthPx = Math.min(targetWidthPx, Math.max(1, Math.round(slot.widthRatio * targetWidthPx)));
    const heightPx = Math.min(targetHeightPx, Math.max(1, Math.round(slot.heightRatio * targetHeightPx)));
    const rawLeft = Math.round(slot.positionX * targetWidthPx - widthPx / 2);
    const rawTop = Math.round(slot.positionY * targetHeightPx - heightPx / 2);
    const left = Math.min(Math.max(0, rawLeft), targetWidthPx - widthPx);
    const top = Math.min(Math.max(0, rawTop), targetHeightPx - heightPx);
    const cropped = await coverCropToBuffer(file, widthPx, heightPx, adjust.positionX, adjust.positionY, adjust.scale);
    composites.push({ input: await cutToShape(cropped, slot, widthPx, heightPx), left, top });
  }

  const overlayResized = await sharp(overlayImage)
    .resize(targetWidthPx, targetHeightPx, { fit: "fill" })
    .png()
    .toBuffer();
  composites.push({ input: overlayResized, left: 0, top: 0 });

  return sharp({
    create: { width: targetWidthPx, height: targetHeightPx, channels: 3, background: "#ffffff" },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();
}

// Découpe la photo recadrée selon la forme de l'emplacement : un masque SVG
// de la même taille, appliqué en « dest-in » (seule la partie couverte par
// la forme est gardée, le reste devient transparent et laisse voir le fond).
async function cutToShape(cropped: Buffer, slot: ThemeSlot, widthPx: number, heightPx: number): Promise<Buffer> {
  if (slotShape(slot) === "rect") return cropped;
  if (slotShape(slot) === "svg") {
    // Masque fourni : rendu à la taille exacte de l'emplacement (étiré), son
    // opacité garde la photo là où il dessine.
    const svgMask = await sharp(Buffer.from(maskSvgSized(slot.maskSvg!, widthPx, heightPx)))
      .resize(widthPx, heightPx, { fit: "fill" })
      .ensureAlpha()
      .png()
      .toBuffer();
    return sharp(cropped).ensureAlpha().composite([{ input: svgMask, blend: "dest-in" }]).png().toBuffer();
  }
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><g fill="#fff">${slotSvgShape(slot, widthPx, heightPx)}</g></svg>`
  );
  return sharp(cropped)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// Photos des emplacements envoyées par l'outil de design (`themeSlot0`,
// `themeSlot1`…), dans l'ordre des emplacements ; null là où il n'y en a pas.
export function themeSlotFilesFromForm(formData: FormData): (File | null)[] {
  return Array.from({ length: MAX_THEME_SLOTS }, (_, i) => {
    const f = formData.get(`themeSlot${i}`);
    return f instanceof File && f.size > 0 ? f : null;
  });
}

// Lit le champ "slots" envoyé par ThemeForm (un tableau JSON de 1 à MAX_THEME_SLOTS
// ThemeSlot) — retourne null si absent/invalide (jamais d'erreur bloquante,
// mais un thème sans emplacement valide n'a pas de sens : les appelants
// traitent null comme une erreur de validation, contrairement aux champs
// facultatifs comme les marques de pli).
export function parseThemeSlotsField(raw: FormDataEntryValue | null): ThemeSlot[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_THEME_SLOTS) return null;
    const slots = parsed.map((s) => ({
      positionX: Number(s?.positionX),
      positionY: Number(s?.positionY),
      widthRatio: Number(s?.widthRatio),
      heightRatio: Number(s?.heightRatio),
    }));
    if (slots.some((s) => Object.values(s).some((n) => !Number.isFinite(n)))) return null;
    return slots.map((s, i): ThemeSlot => ({ ...s, ...sanitizeSlotShape(parsed[i] ?? {}) }));
  } catch {
    return null;
  }
}

// Lit le champ "themeSlotAdjust" envoyé par le client (Design Shopify) — un
// tableau JSON de ThemeSlotAdjust, un par emplacement, dans le même ordre
// que `theme.slots`. Retourne [] (= cadrage "cover" par défaut partout) si
// absent/invalide — jamais bloquant, contrairement à parseThemeSlotsField
// (les emplacements eux-mêmes, définis par l'admin).
export function parseThemeSlotAdjustField(raw: FormDataEntryValue | null): ThemeSlotAdjust[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => {
      const positionX = Number(s?.positionX);
      const positionY = Number(s?.positionY);
      const scale = Number(s?.scale);
      return {
        positionX: Number.isFinite(positionX) ? positionX : 0.5,
        positionY: Number.isFinite(positionY) ? positionY : 0.5,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      };
    });
  } catch {
    return [];
  }
}

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { MAX_MOSAIC_SIDE, isValidMosaicGrid } from "@/lib/design/mosaicGrid";
import { resolveProductImage } from "@/lib/pdf/productSource";
import { generatePrintReadyPdf } from "@/lib/pdf/generate";
import { coverCropToBuffer, parsePositionValue } from "@/lib/pdf/crop";
import { mmToPx } from "@/lib/pdf/units";
import { applyOrientation } from "@/lib/pdf/orientation";
import { pdfDownloadName } from "@/lib/imposition/saved";
import { resolveLayersFromForm } from "@/lib/pdf/layers";
import { parseThemeSlotAdjustField, themeSlotFilesFromForm } from "@/lib/pdf/theme";
import type { Template } from "@/lib/types";
import { parseThemeTextsField } from "@/lib/themeText";

type Db = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Fabrication du PDF prêt-pour-impression à partir du FormData de l'outil.
 *
 * Extrait de app/api/design/pdf/route.ts pour qu'il n'y ait qu'UN SEUL chemin
 * de rendu : la route l'appelle pour un téléchargement immédiat, et le module
 * Commande l'appelle en rejouant le FormData reconstitué depuis un design
 * enregistré (voir formDataFromSubmission). Deux implémentations finiraient
 * par diverger, et une commande ne rendrait plus comme son aperçu.
 *
 * Lève une Error à message lisible : c'est l'appelant qui décide du code HTTP.
 */

function zoomValue(raw: FormDataEntryValue | null): number {
  const n = parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n >= 0.1 ? n : 1;
}

// Normalise à un multiple de 90° dans [0, 360) — seuls ces angles sont
// proposés côté client (voir ImageSourcePicker), mais on protège quand même
// contre une valeur arbitraire envoyée directement à la route.
function rotationValue(raw: FormDataEntryValue | null): number {
  const n = Math.round(Number(raw ?? 0) / 90) * 90;
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}

// Mosaïque de plusieurs photos uploadées (étape « Type de design ») — voir
// resolveProductImage/composeMosaicImage. `side` distingue les champs du
// recto (mosaicCols/mosaicRows/mosaicCell{i}, comme "image"/"positionX")
// de ceux du verso (backMosaicCols/backMosaicRows/backMosaicCell{i}).
export function mosaicFromForm(formData: FormData, side: "front" | "back"): (File | null)[] | null {
  const colsField = side === "back" ? "backMosaicCols" : "mosaicCols";
  const rowsField = side === "back" ? "backMosaicRows" : "mosaicRows";
  const cellField = (i: number) => (side === "back" ? `backMosaicCell${i}` : `mosaicCell${i}`);
  const cols = parseInt(String(formData.get(colsField) ?? ""), 10);
  const rows = parseInt(String(formData.get(rowsField) ?? ""), 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
  // Plafond imposé ici et pas seulement à l'écran : une grille forgée ferait
  // construire des millions de cases (voir lib/design/mosaicGrid.ts).
  const panels = formData.get(side === "back" ? "backMosaicPanels" : "mosaicPanels") === "1";
  if (!isValidMosaicGrid(cols, rows, panels)) {
    throw new Error(`Grille de mosaïque invalide : ${MAX_MOSAIC_SIDE} colonnes et ${MAX_MOSAIC_SIDE} rangées au maximum.`);
  }
  const files = Array.from({ length: cols * rows }, (_, i) => {
    const f = formData.get(cellField(i));
    return f instanceof File && f.size > 0 ? f : null;
  });
  return files.some((f) => f) ? files : null;
}

// Thème (étape « Type de design ») — voir resolveProductImage/
// composeThemeImage. Recto seulement (voir DesignTool : un thème n'a
// qu'un seul graphisme, il ne s'applique jamais au verso).
function themeIdFromForm(formData: FormData): string | null {
  const raw = formData.get("themeId");
  return typeof raw === "string" && raw ? raw : null;
}

export interface RenderedPdf {
  pdf: Buffer;
  filename: string;
}

// `loadedTemplate` : le modèle déjà lu par l'appelant (évite de le relire à
// chaque rendu d'un lot) ; sans lui, il est lu en base.
export async function renderPdfFromForm(
  db: Db,
  formData: FormData,
  templateId: string,
  loadedTemplate?: Template
): Promise<RenderedPdf> {
  const rotated = formData.get("rotated") === "true";

  // Optionnel : sans fichier, le recto se compose quand même — un canvas
  // blanc (voir coverCropToBuffer), pour permettre un montage fait
  // seulement de calques (texte/image/forme).
  const frontFile = formData.get("image");
  const frontPdfPage = Math.max(1, Math.floor(Number(formData.get("pdfPage"))) || 1);
  const positionX = parsePositionValue(formData.get("positionX"));
  const positionY = parsePositionValue(formData.get("positionY"));
  const zoom = zoomValue(formData.get("zoom"));
  const imageRotation = rotationValue(formData.get("imageRotation"));

  const backFile = formData.get("backImage");
  const backPdfPage = Math.max(1, Math.floor(Number(formData.get("backPdfPage"))) || 1);
  const backPositionX = parsePositionValue(formData.get("backPositionX"));
  const backPositionY = parsePositionValue(formData.get("backPositionY"));
  const backZoom = zoomValue(formData.get("backZoom"));
  const backImageRotation = rotationValue(formData.get("backImageRotation"));
  // Calques et modèle sont indépendants : lus ensemble.
  const [layers, backLayers, rawTemplate] = await Promise.all([
    resolveLayersFromForm(formData, "front"),
    resolveLayersFromForm(formData, "back"),
    loadedTemplate
      ? Promise.resolve(loadedTemplate)
      : (async () => {
          const { data, error } = await db.from("templates").select("*").eq("id", templateId).single<Template>();
          if (error || !data) throw new Error("Modèle introuvable.");
          return data;
        })(),
  ]);
  const template = applyOrientation(rawTemplate, rotated);

  // Code SKU (s'il y en a un) préfixé au nom de fichier — c'est justement
  // l'info que l'étape Résumé affiche à côté du bouton de téléchargement,
  // donc le fichier téléchargé porte le même nom.
  let skuCode: string | null = null;
  if (rawTemplate.sku_id) {
    const { data: sku } = await db.from("skus").select("sku").eq("id", rawTemplate.sku_id).single<{ sku: string }>();
    skuCode = sku?.sku ?? null;
  }

  const frontMosaicFiles = mosaicFromForm(formData, "front");
  const backMosaicFiles = mosaicFromForm(formData, "back");
  const mosaicCols = parseInt(String(formData.get("mosaicCols") ?? formData.get("backMosaicCols") ?? ""), 10) || 1;
  const mosaicRows = parseInt(String(formData.get("mosaicRows") ?? formData.get("backMosaicRows") ?? ""), 10) || 1;
  const themeId = themeIdFromForm(formData);
  const themeSlotFiles = themeIdFromForm(formData) ? themeSlotFilesFromForm(formData) : null;
  const themeSlotAdjust = parseThemeSlotAdjustField(formData.get("themeSlotAdjust"));
  const themeTexts = parseThemeTextsField(formData.get("themeTexts"));
  // Cadrage des cases de mosaïque, un jeu par côté (même format que themeSlotAdjust).
  const frontMosaicAdjust = parseThemeSlotAdjustField(formData.get("mosaicCellAdjust"));
  const backMosaicAdjust = parseThemeSlotAdjustField(formData.get("backMosaicCellAdjust"));

  let frontBuffer: Buffer | null = null;
  if (themeId) {
    try {
      const front = await resolveProductImage(db, {
        templateId,
        file: null,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
        themeId,
        themeSlotFiles,
        themeSlotAdjust,
        themeTexts,
      });
      frontBuffer = front.buffer;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Erreur lors du traitement du recto.");
    }
  } else if (frontMosaicFiles) {
    try {
      const front = await resolveProductImage(db, {
        templateId,
        file: null,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
        mosaicFiles: frontMosaicFiles,
        mosaicCols,
        mosaicRows,
        mosaicPanelSide: formData.get("mosaicPanels") === "1" ? "front" : null,
        mosaicCellAdjust: frontMosaicAdjust,
      });
      frontBuffer = front.buffer;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Erreur lors du traitement du recto.");
    }
  } else if (frontFile instanceof File && frontFile.size > 0) {
    try {
      const front = await resolveProductImage(db, {
        templateId,
        file: frontFile,
        pdfPage: frontPdfPage,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
      });
      frontBuffer = front.buffer;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Erreur lors du traitement du recto.");
    }
  }

  let backBuffer: Buffer | null = null;
  if (rawTemplate.two_sided) {
    if (backMosaicFiles) {
      try {
        const back = await resolveProductImage(db, {
          templateId,
          file: null,
          visualId: null,
          visualMode: null,
          tileSizeMm: null,
          rotated,
          mosaicFiles: backMosaicFiles,
          mosaicCols,
          mosaicRows,
          mosaicPanelSide: formData.get("backMosaicPanels") === "1" ? "back" : null,
          mosaicCellAdjust: backMosaicAdjust,
        });
        backBuffer = back.buffer;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Erreur lors du traitement du verso.");
      }
    } else if (backFile instanceof File && backFile.size > 0) {
      try {
        const back = await resolveProductImage(db, {
          templateId,
          file: backFile,
          pdfPage: backPdfPage,
          visualId: null,
          visualMode: null,
          tileSizeMm: null,
          rotated,
        });
        backBuffer = back.buffer;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Erreur lors du traitement du verso.");
      }
    } else if (backLayers.length > 0) {
      // Pas de fichier pour le verso, mais des calques à y montrer : une
      // page quand même (blanche), sinon `generatePrintReadyPdf` n'ajoute de
      // deuxième page que si `backImage` est fourni (comportement partagé
      // avec les vrais Produits, à ne pas changer là-bas — voir
      // lib/pdf/productPdf.ts, où un verso "vide" ne doit toujours pas
      // ajouter de page).
      const pageWidthMm = template.width_mm + template.bleed_mm * 2;
      const pageHeightMm = template.height_mm + template.bleed_mm * 2;
      backBuffer = await coverCropToBuffer(null, mmToPx(pageWidthMm, template.dpi), mmToPx(pageHeightMm, template.dpi));
    }
  }

  let pdf: Buffer;
  try {
    pdf = await generatePrintReadyPdf({
      template,
      sourceImage: frontBuffer,
      logoImage: null,
      positionX,
      positionY,
      zoom,
      imageRotation,
      layers,
      backImage: backBuffer,
      backPositionX,
      backPositionY,
      backZoom,
      backImageRotation,
      backLayers,
      backLogoImage: null,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Erreur lors de la génération du PDF.");
  }

  const filename = pdfDownloadName(skuCode ? `${skuCode}-${template.name}` : template.name);
  return { pdf, filename };
}

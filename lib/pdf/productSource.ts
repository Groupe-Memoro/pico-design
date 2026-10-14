import type { SupabaseClient } from "@supabase/supabase-js";
import { mmToPx } from "./units";
import { composeFullCoverImage, composeTiledImage } from "./visual";
import { composeMosaicImage } from "./mosaic";
import { composeThemeImage } from "./theme";
import { applyOrientation } from "./orientation";
import { panelCells } from "../folds";
import { prepareUploadedFile } from "../visualUpload";
import { isPdfBuffer } from "./rasterizePdf";
import { pdfPageCount, planPdfPages, type PdfPagePlan } from "./pdfPages";
import type { Template, Theme, ThemeSlotAdjust, Visual, VisualMode } from "../types";

export interface ResolveProductImageInput {
  templateId: string;
  file: File | null;
  // Page à rasteriser quand `file` est un PDF (1 = première page).
  pdfPage?: number;
  visualId: string | null;
  visualMode: VisualMode | null;
  tileSizeMm: number | null;
  positionX?: number;
  positionY?: number;
  rotated?: boolean;
  // Mosaïque de plusieurs photos uploadées (Design Shopify, étape « Type de
  // design ») — distincte de `visualMode: "tile"`, qui répète UN seul visuel
  // de la banque. `null`/case manquante d'un tableau = cellule vide (voir
  // composeMosaicImage). Prioritaire sur `file`/`visualId` si présent.
  mosaicFiles?: (File | null)[] | null;
  mosaicCols?: number | null;
  mosaicRows?: number | null;
  // Cadrage de chaque case de la mosaïque (position/zoom), dans l'ordre des
  // cases — voir composeMosaicImage. Absent = photos centrées.
  mosaicCellAdjust?: ThemeSlotAdjust[] | null;
  // Composition par volet (produit plié) : les cases sont les volets de ce
  // côté du modèle (voir panelCells), pas une grille égale.
  mosaicPanelSide?: "front" | "back" | null;
  // Thème (Design Shopify, étape « Type de design ») : un graphisme préfait
  // attribué au modèle, avec un ou plusieurs emplacements où les photos du client sont
  // recadrées — voir composeThemeImage. Prioritaire sur mosaic/file/visualId.
  themeId?: string | null;
  themeSlotFiles?: (File | null)[] | null;
  // Ajustement (position/zoom) du client dans chaque emplacement — voir
  // ThemeSlotAdjust/composeThemeImage. Absent/case manquante = cadrage
  // "cover" par défaut pour cet emplacement.
  themeSlotAdjust?: ThemeSlotAdjust[] | null;
}

export interface ResolvedProductImage {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

/**
 * Pages à tirer d'un PDF importé comme image du recto (voir planPdfPages) :
 * un PDF de deux pages fournit aussi le verso d'un modèle recto-verso.
 * Retourne null si le fichier n'est pas un PDF.
 */
export async function planUploadedPdf(
  file: File | null,
  twoSided: boolean,
  hasOwnBack: boolean
): Promise<PdfPagePlan | null> {
  if (!file) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type !== "application/pdf" && !isPdfBuffer(bytes)) return null;
  return planPdfPages({ pageCount: await pdfPageCount(bytes), twoSided, hasOwnBack });
}

/**
 * Détermine l'image source d'un produit : soit le fichier uploadé tel
 * quel, soit un visuel de la banque composé (plein format ou mosaïque)
 * à la taille exacte de la page du modèle choisi.
 */
export async function resolveProductImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: ResolveProductImageInput
): Promise<ResolvedProductImage> {
  if (input.themeId) {
    const { data: theme, error: themeError } = await supabase
      .from("themes")
      .select("*")
      .eq("id", input.themeId)
      .single<Theme>();
    if (themeError || !theme) {
      throw new Error("Thème introuvable.");
    }
    const { data: overlayData, error: overlayError } = await supabase.storage
      .from("overlays")
      .download(theme.overlay_path);
    if (overlayError || !overlayData) {
      throw new Error("Impossible de télécharger le graphisme du thème.");
    }
    const overlayBuffer = Buffer.from(await overlayData.arrayBuffer());
    // Fond facultatif : introuvable, le thème se rend quand même sur blanc.
    let backgroundBuffer: Buffer | null = null;
    if (theme.background_path) {
      const { data: backgroundData } = await supabase.storage.from("overlays").download(theme.background_path);
      if (backgroundData) backgroundBuffer = Buffer.from(await backgroundData.arrayBuffer());
    }

    const { data: rawTemplate, error: templateError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", input.templateId)
      .single<Template>();
    if (templateError || !rawTemplate) {
      throw new Error("Modèle introuvable.");
    }
    const template = applyOrientation(rawTemplate, input.rotated ?? false);
    const pageWidthMm = template.width_mm + template.bleed_mm * 2;
    const pageHeightMm = template.height_mm + template.bleed_mm * 2;
    const targetWidthPx = mmToPx(pageWidthMm, template.dpi);
    const targetHeightPx = mmToPx(pageHeightMm, template.dpi);

    const slotBuffers = await Promise.all(
      (input.themeSlotFiles ?? []).map(async (f) => (f ? Buffer.from(await f.arrayBuffer()) : null))
    );
    const buffer = await composeThemeImage(
      slotBuffers,
      theme.slots,
      overlayBuffer,
      targetWidthPx,
      targetHeightPx,
      input.themeSlotAdjust ?? [],
      backgroundBuffer
    );
    return { buffer, contentType: "image/jpeg", filename: "theme.jpg" };
  }

  if (input.mosaicFiles && input.mosaicFiles.some((f) => f)) {
    const { data: rawTemplate, error: templateError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", input.templateId)
      .single<Template>();
    if (templateError || !rawTemplate) {
      throw new Error("Modèle introuvable.");
    }
    const template = applyOrientation(rawTemplate, input.rotated ?? false);
    const pageWidthMm = template.width_mm + template.bleed_mm * 2;
    const pageHeightMm = template.height_mm + template.bleed_mm * 2;
    const targetWidthPx = mmToPx(pageWidthMm, template.dpi);
    const targetHeightPx = mmToPx(pageHeightMm, template.dpi);

    const cellBuffers = await Promise.all(
      input.mosaicFiles.map(async (f) => (f ? Buffer.from(await f.arrayBuffer()) : null))
    );
    const buffer = await composeMosaicImage(
      cellBuffers,
      input.mosaicCols ?? 1,
      input.mosaicRows ?? 1,
      targetWidthPx,
      targetHeightPx,
      input.mosaicCellAdjust ?? [],
      input.mosaicPanelSide ? panelCells(template, input.mosaicPanelSide) : null
    );
    return { buffer, contentType: "image/jpeg", filename: "mosaic.jpg" };
  }

  if (input.file) {
    // Un PDF uploadé directement (plutôt qu'un visuel de la banque) est
    // converti en PNG (page demandée, 300 dpi) — le reste du pipeline
    // (recadrage "cover", génération du PDF final) ne traite que des
    // images matricielles.
    const prepared = await prepareUploadedFile(input.file, input.pdfPage);
    return {
      buffer: prepared.buffer,
      contentType: prepared.contentType || "image/jpeg",
      filename: prepared.filename,
    };
  }

  if (!input.visualId || !input.visualMode) {
    throw new Error("Aucune image, ni visuel sélectionné.");
  }

  const { data: rawTemplate, error: templateError } = await supabase
    .from("templates")
    .select("*")
    .eq("id", input.templateId)
    .single<Template>();
  if (templateError || !rawTemplate) {
    throw new Error("Modèle introuvable.");
  }
  const template = applyOrientation(rawTemplate, input.rotated ?? false);

  const { data: visual, error: visualError } = await supabase
    .from("visuals")
    .select("*")
    .eq("id", input.visualId)
    .single<Visual>();
  if (visualError || !visual) {
    throw new Error("Visuel introuvable.");
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("visuals")
    .download(visual.file_path);
  if (downloadError || !fileData) {
    throw new Error("Impossible de télécharger le visuel.");
  }
  const visualBuffer = Buffer.from(await fileData.arrayBuffer());

  const pageWidthMm = template.width_mm + template.bleed_mm * 2;
  const pageHeightMm = template.height_mm + template.bleed_mm * 2;
  const targetWidthPx = mmToPx(pageWidthMm, template.dpi);
  const targetHeightPx = mmToPx(pageHeightMm, template.dpi);

  if (input.visualMode === "tile") {
    const tileSizeMm = input.tileSizeMm ?? 25;
    const tileWidthPx = Math.max(1, mmToPx(tileSizeMm, template.dpi));
    const buffer = await composeTiledImage(
      visualBuffer,
      tileWidthPx,
      targetWidthPx,
      targetHeightPx,
      input.positionX,
      input.positionY
    );
    return { buffer, contentType: "image/jpeg", filename: "visual-tile.jpg" };
  }

  const buffer = await composeFullCoverImage(
    visualBuffer,
    targetWidthPx,
    targetHeightPx,
    input.positionX,
    input.positionY
  );
  return { buffer, contentType: "image/jpeg", filename: "visual-full.jpg" };
}

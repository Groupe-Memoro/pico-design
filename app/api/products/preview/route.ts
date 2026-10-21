import sharp from "sharp";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { parseLogoShadowForm } from "@/lib/logoShadowSettings";
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { publicUploadError } from "@/lib/uploadLimits";
import { MAX_MOSAIC_SIDE, isValidMosaicGrid } from "@/lib/design/mosaicGrid";
import { resolveProductImage } from "@/lib/pdf/productSource";
import { generateTemplatePreviewPng } from "@/lib/pdf/preview";
import { loadLogoImage } from "@/lib/pdf/logo";
import { parsePositionValue } from "@/lib/pdf/crop";
import { applyOrientation } from "@/lib/pdf/orientation";
import { parseThemeSlotAdjustField, themeSlotFilesFromForm } from "@/lib/pdf/theme";
import type { LogoShape, Template, VisualMode } from "@/lib/types";
import { parseThemeTextsField } from "@/lib/themeText";

// Plus grand côté des images d'aperçu renvoyées à l'écran (écrans haute densité compris).
const PREVIEW_IMAGE_MAX_PX = 1800;

export const runtime = "nodejs"; // sharp a besoin du runtime Node, pas Edge.

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let formData = await request.formData();
  const templateId = formData.get("templateId");
  // Voir /api/design/mockup : lien public accepté pour ce seul modèle.
  if (
    !user &&
    !grantAllows(
      formData.get("grant"),
      typeof templateId === "string" ? templateId : "",
    )
  ) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  // Fichiers déposés directement dans le stockage par l'outil (au-delà de
  // la limite de 4,5 Mo des requêtes Vercel) : remis en place avant tout le
  // reste, contrôles de taille compris.
  try {
    formData = await hydrateStagedFiles(formData);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fichier introuvable." },
      { status: 400 },
    );
  }
  if (!user) {
    const limit = await checkRateLimit("preview", request);
    if (!limit.allowed) return tooManyRequests("preview");
    // Même plafond de taille que les autres routes publiques de l'outil.
    const tooBig = publicUploadError(formData);
    if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });
  }
  const db = user ? supabase : createAdminSupabaseClient();
  const file = formData.get("image");
  // Page à afficher quand l'image est un PDF (le verso d'un PDF de deux pages est la page 2).
  const pdfPage = Math.max(1, Math.floor(Number(formData.get("pdfPage"))) || 1);
  const visualId = formData.get("visualId");
  const visualMode = formData.get("visualMode");
  const tileSizeMm = formData.get("tileSizeMm");
  // Mosaïque de plusieurs photos uploadées (Design Shopify) — voir
  // resolveProductImage. `mosaicCols`/`mosaicRows` absents ou nuls = pas de
  // mosaïque (comportement d'origine, aucun appelant existant n'envoie ça).
  const mosaicColsRaw = parseInt(String(formData.get("mosaicCols") ?? ""), 10);
  const mosaicRowsRaw = parseInt(String(formData.get("mosaicRows") ?? ""), 10);
  const mosaicCols =
    Number.isFinite(mosaicColsRaw) && mosaicColsRaw > 0 ? mosaicColsRaw : null;
  const mosaicRows =
    Number.isFinite(mosaicRowsRaw) && mosaicRowsRaw > 0 ? mosaicRowsRaw : null;
  // Par volet (produit plié) : les cases sont les volets du côté montré.
  const mosaicPanels = formData.get("mosaicPanels") === "1";
  // Plafond imposé ici et pas seulement à l'écran (voir lib/design/mosaicGrid.ts).
  if (mosaicCols && mosaicRows && !isValidMosaicGrid(mosaicCols, mosaicRows, mosaicPanels)) {
    return NextResponse.json({ error: `Grille de mosaïque invalide : ${MAX_MOSAIC_SIDE} colonnes et ${MAX_MOSAIC_SIDE} rangées au maximum.` }, { status: 400 });
  }
  const mosaicFiles: (File | null)[] | null =
    mosaicCols && mosaicRows
      ? Array.from({ length: mosaicCols * mosaicRows }, (_, i) => {
          const f = formData.get(`mosaicCell${i}`);
          return f instanceof File && f.size > 0 ? f : null;
        })
      : null;
  // Thème (Design Shopify) — voir resolveProductImage. `themeId` absent =
  // pas de thème (comportement d'origine). Toujours MAX_THEME_SLOTS cases
  // (voir themeSlotFilesFromForm) : composeThemeImage ignore celles au-delà du nombre
  // réel d'emplacements du thème (`theme.slots.length`), pas besoin de
  // connaître ce nombre ici pour construire le tableau.
  const themeIdRaw = formData.get("themeId");
  const themeId =
    typeof themeIdRaw === "string" && themeIdRaw ? themeIdRaw : null;
  const themeSlotFiles = themeSlotFilesFromForm(formData);
  const mosaicCellAdjust = parseThemeSlotAdjustField(formData.get("mosaicCellAdjust"));
  const themeSlotAdjust = parseThemeSlotAdjustField(
    formData.get("themeSlotAdjust"),
  );
  const themeTexts = parseThemeTextsField(formData.get("themeTexts"));
  const logoShape = formData.get("logoShape");
  const logoColor = formData.get("logoColor");
  const logoSecondaryColor = formData.get("logoSecondaryColor");
  const positionX = formData.get("positionX");
  const positionY = formData.get("positionY");
  const rotated = formData.get("rotated") === "true";
  const logoEnabled = formData.get("showLogo") !== "false";
  const logoShadow = parseLogoShadowForm(formData).active;
  // "frame" : cadre seul (traits + gabarit + logo), fond transparent, sans
  //   image ni visuel — calque fixe pendant le repositionnement.
  // "background" : image/visuel déjà recadré/mosaïqué, sans traits ni logo
  //   — utilisé pour le calque mobile en mode mosaïque.
  // (par défaut) : aperçu complet aplati (fond + traits + logo).
  const mode = formData.get("mode");
  // "back" : verso — pas de logo Pico (jamais superposé au verso).
  const side = formData.get("side") === "back" ? "back" : "front";
  // Aperçu final propre (Design Shopify) : image + logo seuls, sans trait de
  // coupe ni marge de sécurité — sans effet sur les modes "frame"/"background".
  const guides = formData.get("guides") !== "false";
  // Resserre le cadrage de l'image (étape « Aperçu » de Design Shopify) — sans
  // effet sur les modes "frame"/"background" (voir generateTemplatePreviewPng).
  const zoomValue = parseFloat(String(formData.get("zoom") ?? ""));
  const zoom = Number.isFinite(zoomValue) && zoomValue >= 0.1 ? zoomValue : 1;

  if (typeof templateId !== "string") {
    return NextResponse.json(
      { error: "Paramètre manquant (templateId)." },
      { status: 400 },
    );
  }

  const clampedPositionX = parsePositionValue(positionX);
  const clampedPositionY = parsePositionValue(positionY);

  const { data: rawTemplate, error: templateError } = await db
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .single<Template>();
  if (templateError || !rawTemplate) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }
  const template = applyOrientation(rawTemplate, rotated);

  const admin = createAdminSupabaseClient();

  if (mode === "frame") {
    let logoBuffer: Buffer | null = null;
    let overlayBuffer: Buffer | null = null;
    const showLogo =
      logoEnabled &&
      (side === "front"
        ? template.logo_on_front
        : template.two_sided && template.logo_on_back);
    if (showLogo) {
      const shape: LogoShape = logoShape === "pastille" ? "pastille" : "logo";
      const color = typeof logoColor === "string" ? logoColor : "#000000";
      const secondaryColor =
        typeof logoSecondaryColor === "string" ? logoSecondaryColor : "#FFFFFF";
      logoBuffer = await loadLogoImage(admin, shape, color, secondaryColor);
    }
    if (side === "front" && template.overlay_path) {
      const { data: overlayData } = await admin.storage
        .from("overlays")
        .download(template.overlay_path);
      overlayBuffer = overlayData
        ? Buffer.from(await overlayData.arrayBuffer())
        : null;
    }

    const png = await generateTemplatePreviewPng(
      template,
      logoBuffer,
      null,
      overlayBuffer,
      0.5,
      0.5,
      true,
      logoShadow,
      true,
      1,
      side,
    );
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  }

  let resolved;
  try {
    resolved = await resolveProductImage(db, {
      templateId,
      file: file instanceof File && file.size > 0 ? file : null,
      pdfPage,
      visualId: typeof visualId === "string" ? visualId : null,
      visualMode:
        typeof visualMode === "string" ? (visualMode as VisualMode) : null,
      tileSizeMm:
        typeof tileSizeMm === "string" ? parseFloat(tileSizeMm) : null,
      positionX: clampedPositionX,
      positionY: clampedPositionY,
      rotated,
      mosaicFiles,
      mosaicCols,
      mosaicRows,
      mosaicPanelSide: mosaicPanels ? side : null,
      mosaicCellAdjust,
      themeId,
      themeSlotFiles,
      themeSlotAdjust,
      themeTexts,
      // Un aperçu : inutile de composer un visuel de la banque à 300 dpi.
      maxPx: PREVIEW_IMAGE_MAX_PX,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Erreur lors du traitement de l'image.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (mode === "background") {
    // Réduit à la taille d'affichage : renvoyer l'image d'impression entière
    // (des dizaines de Mo en grand format) ralentissait chaque réglage.
    const shown = await sharp(resolved.buffer)
      .resize(PREVIEW_IMAGE_MAX_PX, PREVIEW_IMAGE_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return new NextResponse(new Uint8Array(shown), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const showLogo =
    logoEnabled &&
    (side === "front"
      ? template.logo_on_front
      : template.two_sided && template.logo_on_back);
  let logoBuffer: Buffer | null = null;
  if (showLogo) {
    const shape: LogoShape = logoShape === "pastille" ? "pastille" : "logo";
    const color = typeof logoColor === "string" ? logoColor : "#000000";
    const secondaryColor =
      typeof logoSecondaryColor === "string" ? logoSecondaryColor : "#FFFFFF";
    logoBuffer = await loadLogoImage(admin, shape, color, secondaryColor);
  }

  let overlayBuffer: Buffer | null = null;
  if (template.overlay_path) {
    const { data: overlayData } = await admin.storage
      .from("overlays")
      .download(template.overlay_path);
    overlayBuffer = overlayData
      ? Buffer.from(await overlayData.arrayBuffer())
      : null;
  }

  const png = await generateTemplatePreviewPng(
    template,
    logoBuffer,
    resolved.buffer,
    overlayBuffer,
    clampedPositionX,
    clampedPositionY,
    false,
    logoShadow,
    guides,
    zoom,
    side,
  );

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}

import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase/server";
import { resolveProductImage } from "@/lib/pdf/productSource";
import { generateProductMockupPng } from "@/lib/pdf/mockup";
import { generateBeautyShotMockupPng } from "@/lib/pdf/beautyShot";
import { loadBeautyShotBundle } from "@/lib/pdf/beautyShotBundle";
import { parseFold } from "@/lib/folds";
import { generateFoldedMockupPng } from "@/lib/pdf/foldedMockup";
import { resolveMockupBundle } from "@/lib/templateMockups";
import { grantAllows } from "@/lib/publicDesign";
import { publicUploadError } from "@/lib/uploadLimits";
import { MAX_MOSAIC_SIDE, isValidMosaicGrid } from "@/lib/design/mosaicGrid";
import { parsePositionValue } from "@/lib/pdf/crop";
import { applyOrientation } from "@/lib/pdf/orientation";
import { generateStationeryMockupPng } from "@/lib/pdf/stationeryMockup";
import { resolveLayersFromForm } from "@/lib/pdf/layers";
import { parseThemeSlotAdjustField, themeSlotFilesFromForm } from "@/lib/pdf/theme";
import type { Template } from "@/lib/types";

export const runtime = "nodejs"; // sharp a besoin du runtime Node, pas Edge.

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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

/**
 * Design Shopify (étape Résumé) : mockup d'**un seul** côté par appel
 * (`side`, "front" par défaut — le résumé fait un appel par côté pour
 * afficher recto et verso comme deux rendus distincts et bien identifiés,
 * plutôt qu'un seul rendu composite). À partir directement d'un templateId
 * + fichier envoyés, sans passer par un Produit (l'outil n'en crée jamais).
 * Jamais de logo Pico sur le mockup (voir /api/design/pdf), même si le
 * modèle a `logo_on_front`/`logo_on_back`.
 *
 * Deux rendus possibles selon ce que le modèle a en base :
 * - Beauty shot XML, ou masque + ombrage : mockup réaliste sur le produit
 *   physique — même rendu que `/api/products/[id]/mockup`. Toujours un
 *   recto (les modèles avec ce bundle, ex. étuis de téléphone, sont à
 *   recto seul) : `side=back` y répond 204 — sauf pour un produit plié,
 *   dont le dépliant ouvert montre aussi son intérieur.
 * - Aucun des deux (typiquement la papeterie) : repli générique — le
 *   visuel de ce côté à sa dimension finale avec une ombre portée, voir
 *   generateStationeryMockupPng ; un produit plié y est montré entrouvert,
 *   d'après ses volets (generateFoldedMockupPng). Avant, ces modèles n'avaient simplement
 *   aucun mockup (204) ; ils en ont maintenant un.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let formData = await request.formData();
  const templateId = formData.get("templateId");
  if (typeof templateId !== "string")
    return errorResponse("Paramètre manquant (templateId).");
  // Sans session, un laissez-passer valable POUR CE MODÈLE suffit (lien
  // public, voir lib/publicDesign.ts). Les lectures passent alors par le
  // client admin : la RLS n'aurait personne à autoriser.
  if (!user && !grantAllows(formData.get("grant"), templateId)) {
    return errorResponse("Non authentifié.", 401);
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
  // Appel public : compter et plafonner (voir lib/rateLimit.ts). Les
  // utilisateurs connectés ne sont pas limités.
  if (!user) {
    const limit = await checkRateLimit("mockup", request);
    if (!limit.allowed) return tooManyRequests("mockup");
    // Le débit plafonne les APPELS, pas les octets (voir lib/uploadLimits.ts).
    const tropLourd = publicUploadError(formData);
    if (tropLourd) return errorResponse(tropLourd, 413);
  }
  const db = user ? supabase : createAdminSupabaseClient();
  const rotated = formData.get("rotated") === "true";
  const side = formData.get("side") === "back" ? "back" : "front";
  // Quel mockup rendre, quand le modèle en a plusieurs (voir
  // resolveMockupBundle) — absent = le premier.
  const mockupIdField = formData.get("mockupId");
  const mockupId =
    typeof mockupIdField === "string" && mockupIdField ? mockupIdField : null;

  // Optionnel : sans fichier, le mockup se compose quand même — un canvas
  // blanc (voir coverCropToBuffer), pour permettre un montage fait
  // seulement de calques (texte/image/forme).
  const file = formData.get("image");
  const pdfPage = Math.max(1, Math.floor(Number(formData.get("pdfPage"))) || 1);
  const positionX = parsePositionValue(formData.get("positionX"));
  const positionY = parsePositionValue(formData.get("positionY"));
  const zoom = zoomValue(formData.get("zoom"));
  const imageRotation = rotationValue(formData.get("imageRotation"));
  const layers = await resolveLayersFromForm(formData, side);
  // Mosaïque de plusieurs photos uploadées (étape « Type de design ») — voir
  // resolveProductImage/composeMosaicImage. Un seul côté par appel ici
  // (`side`), donc champs non préfixés, comme "image"/"positionX".
  const mosaicCols = parseInt(String(formData.get("mosaicCols") ?? ""), 10);
  const mosaicRows = parseInt(String(formData.get("mosaicRows") ?? ""), 10);
  const hasMosaicGrid =
    Number.isFinite(mosaicCols) &&
    Number.isFinite(mosaicRows) &&
    mosaicCols > 0 &&
    mosaicRows > 0;
  // Plafond imposé ici et pas seulement à l'écran (voir lib/design/mosaicGrid.ts).
  const mosaicPanels = formData.get("mosaicPanels") === "1";
  if (hasMosaicGrid && !isValidMosaicGrid(mosaicCols, mosaicRows, mosaicPanels)) {
    return errorResponse(`Grille de mosaïque invalide : ${MAX_MOSAIC_SIDE} colonnes et ${MAX_MOSAIC_SIDE} rangées au maximum.`);
  }
  const mosaicFiles: (File | null)[] | null = hasMosaicGrid
    ? Array.from({ length: mosaicCols * mosaicRows }, (_, i) => {
        const f = formData.get(`mosaicCell${i}`);
        return f instanceof File && f.size > 0 ? f : null;
      })
    : null;
  const hasMosaic = Boolean(mosaicFiles && mosaicFiles.some((f) => f));
  // Thème (étape « Type de design ») — recto seulement (voir DesignTool :
  // un thème n'a qu'un seul graphisme, il ne s'applique jamais au verso).
  const themeIdRaw = formData.get("themeId");
  const themeId =
    side === "front" && typeof themeIdRaw === "string" && themeIdRaw
      ? themeIdRaw
      : null;
  const themeSlotFiles = themeSlotFilesFromForm(formData);
  // Cadrage des cases de mosaïque du côté rendu (un seul côté par appel).
  const mosaicCellAdjust = parseThemeSlotAdjustField(formData.get("mosaicCellAdjust"));
  const themeSlotAdjust = parseThemeSlotAdjustField(
    formData.get("themeSlotAdjust"),
  );
  const hasFile = file instanceof File && file.size > 0;
  // Rien à montrer pour ce côté (ni visuel, ni mosaïque, ni thème, ni
  // calque) : pas la peine de composer un mockup entièrement blanc.
  if (!hasFile && !hasMosaic && !themeId && layers.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const { data: rawTemplate, error: templateError } = await db
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .single<Template>();
  if (templateError || !rawTemplate)
    return errorResponse("Modèle introuvable.", 404);

  // Le bundle peut venir de la table template_mockups (un modèle peut en
  // avoir plusieurs) ou, à défaut, des colonnes héritées du modèle — voir
  // resolveMockupBundle.
  const bundle = await resolveMockupBundle(db, rawTemplate, mockupId);
  if (mockupId && !bundle)
    return errorResponse("Mockup introuvable pour ce modèle.", 404);
  const hasRealisticBundle = Boolean(
    bundle || (rawTemplate.mask_path && rawTemplate.shading_path),
  );

  // Les modèles à bundle réaliste sont toujours à recto seul (aucun n'a de
  // second rendu "verso") — un appel side=back pour l'un d'eux n'a rien à
  // montrer, comme un modèle générique sans verso.
  // Exception : un produit plié, dont le mockup ouvert montre aussi l'intérieur.
  const folded = Boolean(parseFold(rawTemplate.fold));
  if (side === "back" && ((hasRealisticBundle && !folded) || !rawTemplate.two_sided)) {
    return new NextResponse(null, { status: 204 });
  }

  const template = applyOrientation(rawTemplate, rotated);

  let resolvedBuffer: Buffer | null = null;
  if (themeId) {
    try {
      const resolved = await resolveProductImage(db, {
        templateId,
        file: null,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
        themeId,
        themeSlotFiles,
        themeSlotAdjust,
      });
      resolvedBuffer = resolved.buffer;
    } catch (err) {
      return errorResponse(
        err instanceof Error
          ? err.message
          : "Erreur lors du traitement de l'image.",
      );
    }
  } else if (hasMosaic) {
    try {
      const resolved = await resolveProductImage(db, {
        templateId,
        file: null,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
        mosaicFiles,
        mosaicCols,
        mosaicRows,
        mosaicPanelSide: mosaicPanels ? side : null,
        mosaicCellAdjust,
      });
      resolvedBuffer = resolved.buffer;
    } catch (err) {
      return errorResponse(
        err instanceof Error
          ? err.message
          : "Erreur lors du traitement de l'image.",
      );
    }
  } else if (hasFile) {
    try {
      const resolved = await resolveProductImage(db, {
        templateId,
        file,
        pdfPage,
        visualId: null,
        visualMode: null,
        tileSizeMm: null,
        rotated,
      });
      resolvedBuffer = resolved.buffer;
    } catch (err) {
      return errorResponse(
        err instanceof Error
          ? err.message
          : "Erreur lors du traitement de l'image.",
      );
    }
  }

  if (!hasRealisticBundle) {
    try {
      // Produit plié sans mockup photo : le dépliant entrouvert, généré
      // d'après ses volets (voir foldedMockup.ts), à partir du côté à plat.
      const foldConfig = parseFold(template.fold);
      const sideImage = await generateStationeryMockupPng({
        template,
        image: resolvedBuffer,
        positionX,
        positionY,
        zoom,
        rotation: imageRotation,
        layers,
        flat: Boolean(foldConfig),
        maxDimPx: foldConfig ? 2000 : undefined,
        format: "webp",
      });
      const png = foldConfig
        ? await generateFoldedMockupPng({
            print: sideImage,
            fold: foldConfig,
            widthMm: template.width_mm,
            heightMm: template.height_mm,
            side,
            format: "webp",
          })
        : sideImage;
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (err) {
      return errorResponse(
        err instanceof Error
          ? err.message
          : "Erreur lors de la génération du mockup.",
        500,
      );
    }
  }

  const admin = createAdminSupabaseClient();

  try {
    if (bundle) {
      const { config, assets } = await loadBeautyShotBundle(
        admin.storage,
        bundle.xmlPath,
      );

      // Deux cadrages distincts, à ne pas confondre (voir
      // buildDesignForZone) : celui du CLIENT place son visuel sur la page,
      // celui du MOCKUP choisit la tranche que la caméra voit.
      const png = await generateBeautyShotMockupPng(
        template,
        config,
        assets,
        resolvedBuffer,
        null,
        positionX,
        positionY,
        null,
        bundle.overlayOpacities,
        zoom,
        imageRotation,
        layers,
        bundle.marginLeft,
        bundle.marginRight,
        bundle.marginTop,
        bundle.marginBottom,
        bundle.positionX ?? 0.5,
        bundle.positionY ?? 0.5,
        bundle.zoom ?? 1,
        side,
        "webp",
      );
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-store",
        },
      });
    }

    const [maskRes, shadingRes] = await Promise.all([
      admin.storage.from("overlays").download(rawTemplate.mask_path!),
      admin.storage.from("overlays").download(rawTemplate.shading_path!),
    ]);
    if (!maskRes.data || !shadingRes.data)
      return errorResponse(
        "Impossible de charger les fichiers du mockup.",
        500,
      );

    const png = await generateProductMockupPng(
      template,
      resolvedBuffer,
      Buffer.from(await maskRes.data.arrayBuffer()),
      Buffer.from(await shadingRes.data.arrayBuffer()),
      null,
      positionX,
      positionY,
      null,
      zoom,
      imageRotation,
      layers,
    );
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error
        ? err.message
        : "Erreur lors de la génération du mockup.",
      500,
    );
  }
}

import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { panelsToSideImages } from "@/lib/products/panelsForm";
import { parseLogoShadowForm } from "@/lib/logoShadowSettings";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { planUploadedPdf, resolveProductImage } from "@/lib/pdf/productSource";
import { isValidLogoColor } from "@/lib/pdf/logo";
import { generateAndStoreProductPdf } from "@/lib/pdf/productPdf";
import { parsePositionValue } from "@/lib/pdf/crop";
import type { LogoShape, Template, VisualMode } from "@/lib/types";
import { storageFileName } from "@/lib/storageName";

export const runtime = "nodejs"; // sharp/pdf-lib ont besoin du runtime Node, pas Edge.

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // Envoi direct au stockage pour les gros fichiers (voir stageLargeFiles), puis
  // composition par volet d'un produit plié, assemblée en une image par côté.
  let formData: FormData;
  try {
    formData = await panelsToSideImages(supabase, await hydrateStagedFiles(await request.formData()));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors du traitement des volets." }, { status: 400 });
  }
  const name = formData.get("name");
  const templateId = formData.get("templateId");
  const file = formData.get("image");
  const visualId = formData.get("visualId");
  const visualMode = formData.get("visualMode");
  const tileSizeMm = formData.get("tileSizeMm");
  const logoShape = formData.get("logoShape");
  const logoColor = formData.get("logoColor");
  const logoSecondaryColor = formData.get("logoSecondaryColor");
  const collectionId = formData.get("collectionId");
  const positionX = parsePositionValue(formData.get("positionX"));
  const positionY = parsePositionValue(formData.get("positionY"));
  const backFile = formData.get("backImage");
  const backVisualId = formData.get("backVisualId");
  const backVisualMode = formData.get("backVisualMode");
  const backTileSizeMm = formData.get("backTileSizeMm");
  const backPositionX = parsePositionValue(formData.get("backPositionX"));
  const backPositionY = parsePositionValue(formData.get("backPositionY"));
  const rotated = formData.get("rotated") === "true";
  const showLogo = formData.get("showLogo") !== "false";
  const logoShadow = parseLogoShadowForm(formData);

  if (typeof name !== "string" || typeof templateId !== "string") {
    return NextResponse.json(
      { error: "Paramètres manquants (name, templateId)." },
      { status: 400 }
    );
  }

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .single<Template>();
  if (templateError || !template) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }

  const shape: LogoShape = logoShape === "pastille" ? "pastille" : "logo";
  const color = typeof logoColor === "string" && isValidLogoColor(logoColor) ? logoColor : "#000000";
  const secondaryColor =
    typeof logoSecondaryColor === "string" && isValidLogoColor(logoSecondaryColor)
      ? logoSecondaryColor
      : "#FFFFFF";

  const update: Record<string, unknown> = {
    name,
    template_id: templateId,
    logo_shape: shape,
    logo_color: color,
    logo_secondary_color: secondaryColor,
    show_logo: showLogo,
    ...logoShadow.columns,
    rotated,
    collection_id: typeof collectionId === "string" && collectionId ? collectionId : null,
    image_position_x: positionX,
    image_position_y: positionY,
  };
  const hasNewSource = file instanceof File && file.size > 0
    ? true
    : typeof visualId === "string" && typeof visualMode === "string";
  const hasOwnBack =
    template.two_sided &&
    (backFile instanceof File && backFile.size > 0
      ? true
      : typeof backVisualId === "string" && typeof backVisualMode === "string");
  // Un PDF de deux pages fournit le recto (page 1) et, pour un modèle
  // recto-verso sans autre verso, le verso (page 2). Sinon, les pages en trop
  // sont ignorées et on le signale.
  const frontFile = file instanceof File && file.size > 0 ? file : null;
  const pdfPlan = await planUploadedPdf(frontFile, template.two_sided, hasOwnBack);
  const backFromPdf = pdfPlan?.backPage ?? null;
  const hasNewBackSource = hasOwnBack || backFromPdf !== null;
  const warnings = pdfPlan?.warning ? [pdfPlan.warning] : [];

  const admin = createAdminSupabaseClient();
  let sourceBufferForPdf: Buffer | null = null;
  let backBufferForPdf: Buffer | null = null;

  // Chargé une seule fois, au besoin, pour régénérer le PDF sans re-upload
  // (recto et/ou verso inchangés) à partir de ce qui est déjà enregistré.
  let current: { image_path: string; back_image_path: string | null } | null = null;
  async function loadCurrent() {
    if (current) return current;
    const { data } = await supabase
      .from("products")
      .select("image_path, back_image_path")
      .eq("id", params.id)
      .single<{ image_path: string; back_image_path: string | null }>();
    current = data ?? null;
    return current;
  }

  if (hasNewSource) {
    let resolved;
    try {
      resolved = await resolveProductImage(supabase, {
        templateId,
        file: file instanceof File && file.size > 0 ? file : null,
        visualId: typeof visualId === "string" ? visualId : null,
        visualMode: typeof visualMode === "string" ? (visualMode as VisualMode) : null,
        tileSizeMm: typeof tileSizeMm === "string" ? parseFloat(tileSizeMm) : null,
        positionX,
        positionY,
        rotated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors du traitement de l'image.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const imagePath = `products/${params.id}/source-${storageFileName(resolved.filename)}`;
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(imagePath, resolved.buffer, { contentType: resolved.contentType, upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    update.image_path = imagePath;
    update.visual_id = file instanceof File && file.size > 0 ? null : (visualId as string);
    update.visual_mode = file instanceof File && file.size > 0 ? null : (visualMode as string);
    update.tile_size_mm =
      file instanceof File && file.size > 0
        ? null
        : typeof tileSizeMm === "string"
        ? parseFloat(tileSizeMm)
        : null;
    sourceBufferForPdf = resolved.buffer;
  } else {
    // Pas de nouvelle image : régénérer le PDF (modèle/logo ont pu changer)
    // à partir de l'image actuellement enregistrée pour ce produit.
    const row = await loadCurrent();
    if (row) {
      const { data: existingFile } = await admin.storage.from("uploads").download(row.image_path);
      if (existingFile) sourceBufferForPdf = Buffer.from(await existingFile.arrayBuffer());
    }
  }

  if (!template.two_sided) {
    // Le modèle n'est plus (ou pas) recto-verso : on ne garde pas de
    // configuration de verso orpheline.
    update.back_image_path = null;
    update.back_visual_id = null;
    update.back_visual_mode = null;
    update.back_tile_size_mm = null;
    update.back_image_position_x = backPositionX;
    update.back_image_position_y = backPositionY;
  } else if (hasNewBackSource) {
    let resolvedBack;
    try {
      resolvedBack = await resolveProductImage(supabase, {
        templateId,
        file: backFromPdf ? frontFile : backFile instanceof File && backFile.size > 0 ? backFile : null,
        pdfPage: backFromPdf ?? 1,
        visualId: typeof backVisualId === "string" ? backVisualId : null,
        visualMode: typeof backVisualMode === "string" ? (backVisualMode as VisualMode) : null,
        tileSizeMm: typeof backTileSizeMm === "string" ? parseFloat(backTileSizeMm) : null,
        positionX: backPositionX,
        positionY: backPositionY,
        rotated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors du traitement du verso.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const backImagePath = `products/${params.id}/back-${storageFileName(resolvedBack.filename)}`;
    const { error: backUploadError } = await supabase.storage
      .from("uploads")
      .upload(backImagePath, resolvedBack.buffer, {
        contentType: resolvedBack.contentType,
        upsert: true,
      });
    if (backUploadError) {
      return NextResponse.json({ error: backUploadError.message }, { status: 500 });
    }
    update.back_image_path = backImagePath;
    const backIsFile = backFromPdf !== null || (backFile instanceof File && backFile.size > 0);
    update.back_visual_id = backIsFile ? null : (backVisualId as string);
    update.back_visual_mode = backIsFile ? null : (backVisualMode as string);
    update.back_tile_size_mm =
      backIsFile
        ? null
        : typeof backTileSizeMm === "string"
        ? parseFloat(backTileSizeMm)
        : null;
    update.back_image_position_x = backPositionX;
    update.back_image_position_y = backPositionY;
    backBufferForPdf = resolvedBack.buffer;
  } else {
    // Recto-verso, pas de nouvelle image de verso : réutiliser celle déjà
    // enregistrée (si présente) pour régénérer le PDF avec la position
    // éventuellement ajustée.
    update.back_image_position_x = backPositionX;
    update.back_image_position_y = backPositionY;
    const row = await loadCurrent();
    if (row?.back_image_path) {
      const { data: existingBackFile } = await admin.storage
        .from("uploads")
        .download(row.back_image_path);
      if (existingBackFile) backBufferForPdf = Buffer.from(await existingBackFile.arrayBuffer());
    }
  }

  // Le PDF prêt-pour-impression est régénéré dès l'enregistrement du produit
  // (pas à la demande) — une erreur ici n'empêche pas de sauvegarder le
  // produit, mais est remontée au client via pdfError.
  let pdfError: string | null = null;
  if (sourceBufferForPdf) {
    try {
      update.pdf_path = await generateAndStoreProductPdf(admin, {
        productId: params.id,
        templateId,
        sourceImage: sourceBufferForPdf,
        logoShape: shape,
        logoColor: color,
        logoSecondaryColor: secondaryColor,
        showLogo,
        logoShadow: logoShadow.active,
        rotated,
        positionX,
        positionY,
        backImage: backBufferForPdf,
        backPositionX,
        backPositionY,
      });
    } catch (err) {
      pdfError = err instanceof Error ? err.message : "Erreur lors de la génération du PDF.";
    }
  }

  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data, pdfError, warnings });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", params.id)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Produit introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { panelsToSideImages } from "@/lib/products/panelsForm";
import { parseLogoShadowForm } from "@/lib/logoShadowSettings";
import { randomUUID } from "crypto";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { planUploadedPdf, resolveProductImage } from "@/lib/pdf/productSource";
import { isValidLogoColor } from "@/lib/pdf/logo";
import { generateAndStoreProductPdf } from "@/lib/pdf/productPdf";
import { parsePositionValue } from "@/lib/pdf/crop";
import type { LogoShape, Template, VisualMode } from "@/lib/types";
import { storageFileName } from "@/lib/storageName";
import { selectAll } from "@/lib/supabase/selectAll";

export const runtime = "nodejs"; // sharp/pdf-lib ont besoin du runtime Node, pas Edge.

export async function GET() {
  const supabase = createServerSupabaseClient();
  try {
    const products = await selectAll((from, to) =>
      supabase.from("products").select("*").order("name", { ascending: true }).order("id", { ascending: true }).range(from, to)
    );
    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  const frontFile = file instanceof File ? file : null;
  const hasOwnBack =
    template.two_sided &&
    (backFile instanceof File && backFile.size > 0
      ? true
      : typeof backVisualId === "string" && typeof backVisualMode === "string");
  // Un PDF de deux pages fournit le recto (page 1) et, pour un modèle
  // recto-verso sans autre verso, le verso (page 2). Sinon, les pages en trop
  // sont ignorées et on le signale.
  const pdfPlan = await planUploadedPdf(frontFile, template.two_sided, hasOwnBack);
  const backFromPdf = pdfPlan?.backPage ?? null;
  const warnings = pdfPlan?.warning ? [pdfPlan.warning] : [];

  let resolved;
  try {
    resolved = await resolveProductImage(supabase, {
      templateId,
      file: frontFile,
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

  let resolvedBack: Awaited<ReturnType<typeof resolveProductImage>> | null = null;
  if (hasOwnBack || backFromPdf) {
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
  }

  const productId = randomUUID();
  const imagePath = `products/${productId}/source-${storageFileName(resolved.filename)}`;

  // Les images sources partent vers le stockage pendant que le PDF se
  // génère (plus bas) : les deux prennent chacun une à quelques secondes en
  // grand format.
  const backImagePath = resolvedBack ? `products/${productId}/back-${storageFileName(resolvedBack.filename)}` : null;
  const uploads = Promise.all([
    supabase.storage
      .from("uploads")
      .upload(imagePath, resolved.buffer, { contentType: resolved.contentType, upsert: true }),
    resolvedBack && backImagePath
      ? supabase.storage
          .from("uploads")
          .upload(backImagePath, resolvedBack.buffer, { contentType: resolvedBack.contentType, upsert: true })
      : Promise.resolve({ error: null }),
  ]);

  const shape: LogoShape = logoShape === "pastille" ? "pastille" : "logo";
  const color = typeof logoColor === "string" && isValidLogoColor(logoColor) ? logoColor : "#000000";
  const secondaryColor =
    typeof logoSecondaryColor === "string" && isValidLogoColor(logoSecondaryColor)
      ? logoSecondaryColor
      : "#FFFFFF";

  // Le PDF prêt-pour-impression est généré dès l'enregistrement du produit
  // (pas à la demande) — une erreur ici n'empêche pas de sauvegarder le
  // produit, mais est remontée au client via pdfError.
  const admin = createAdminSupabaseClient();
  let pdfPath: string | null = null;
  let pdfError: string | null = null;
  try {
    pdfPath = await generateAndStoreProductPdf(admin, {
      productId,
      templateId,
      sourceImage: resolved.buffer,
      logoShape: shape,
      logoColor: color,
      logoSecondaryColor: secondaryColor,
      showLogo,
      logoShadow: logoShadow.active,
      rotated,
      positionX,
      positionY,
      backImage: resolvedBack?.buffer ?? null,
      backPositionX,
      backPositionY,
    });
  } catch (err) {
    pdfError = err instanceof Error ? err.message : "Erreur lors de la génération du PDF.";
  }

  const uploadError = (await uploads).find((r) => r.error)?.error;
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      id: productId,
      name,
      template_id: templateId,
      image_path: imagePath,
      visual_id: typeof visualId === "string" ? visualId : null,
      visual_mode: typeof visualMode === "string" ? visualMode : null,
      tile_size_mm: typeof tileSizeMm === "string" ? parseFloat(tileSizeMm) : null,
      logo_shape: shape,
      logo_color: color,
      logo_secondary_color: secondaryColor,
      show_logo: showLogo,
      ...logoShadow.columns,
      rotated,
      collection_id: typeof collectionId === "string" && collectionId ? collectionId : null,
      pdf_path: pdfPath,
      image_position_x: positionX,
      image_position_y: positionY,
      back_image_path: backImagePath,
      back_visual_id: !backFromPdf && resolvedBack && typeof backVisualId === "string" ? backVisualId : null,
      back_visual_mode:
        !backFromPdf && resolvedBack && typeof backVisualMode === "string" ? backVisualMode : null,
      back_tile_size_mm:
        !backFromPdf && resolvedBack && typeof backTileSizeMm === "string" ? parseFloat(backTileSizeMm) : null,
      back_image_position_x: backPositionX,
      back_image_position_y: backPositionY,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data, pdfError, warnings });
}

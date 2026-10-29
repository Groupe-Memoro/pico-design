import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { uploadBeautyShotBundle } from "@/lib/templateBeautyShotUpload";
import { parseOverlayOpacitiesField } from "@/lib/pdf/beautyShot";
import { parseFoldField, parseFoldMarksField } from "@/lib/pdf/foldMarks";
import { storageFileName } from "@/lib/storageName";

const STRING_FIELDS = ["name", "category_id", "logo_h_align", "logo_v_align"] as const;
const NULLABLE_STRING_FIELDS = ["sku_id"] as const;
const NUMERIC_FIELDS = [
  "width_mm",
  "height_mm",
  "bleed_mm",
  "safety_margin_x_mm",
  "safety_margin_y_mm",
  "print_margin_x_mm",
  "print_margin_y_mm",
  "dpi",
  "logo_width_mm",
  "logo_margin_x_mm",
  "logo_margin_y_mm",
] as const;
const BOOLEAN_FIELDS = [
  "two_sided",
  "logo_on_front",
  "logo_on_back",
  "allow_orientation_change",
] as const;

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const formData = await request.formData();
  const update: Record<string, unknown> = {};
  for (const field of STRING_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") update[field] = v;
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") update[field] = v === "" ? null : v;
  }
  for (const field of NUMERIC_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") update[field] = parseFloat(v);
  }
  for (const field of BOOLEAN_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") update[field] = v === "true";
  }

  async function handleOptionalFile(field: string, dbColumn: string) {
    const file = formData.get(field);
    const remove = formData.get(`remove${field[0].toUpperCase()}${field.slice(1)}`) === "true";
    if (file instanceof File && file.size > 0) {
      const path = `${params.id}/${field}-${storageFileName(file.name)}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from("overlays")
        .upload(path, buffer, { contentType: file.type || "image/png", upsert: true });
      if (uploadError) throw uploadError;
      update[dbColumn] = path;
    } else if (remove) {
      update[dbColumn] = null;
    }
  }

  try {
    await handleOptionalFile("overlay", "overlay_path");
    await handleOptionalFile("mask", "mask_path");
    await handleOptionalFile("shading", "shading_path");

    // Idem : plus envoyé par TemplateForm (voir /api/template-mockups),
    // conservé pour les appels directs et les modèles déjà configurés.
    if (formData.get("removeBeautyShot") === "true") {
      update.beauty_shot_xml_path = null;
    } else if (formData.get("beautyShotXml") || formData.getAll("beautyShotImages").length > 0) {
      const { data: existing } = await supabase
        .from("templates")
        .select("beauty_shot_xml_path")
        .eq("id", params.id)
        .single();
      const beautyShotXmlPath = await uploadBeautyShotBundle(
        supabase.storage,
        formData,
        params.id,
        existing?.beauty_shot_xml_path ?? null
      );
      if (beautyShotXmlPath) update.beauty_shot_xml_path = beautyShotXmlPath;
    }

    if (formData.has("beautyShotOverlayOpacities")) {
      update.beauty_shot_overlay_opacities = parseOverlayOpacitiesField(
        formData.get("beautyShotOverlayOpacities")
      );
    }
    if (formData.has("foldMarksVertical")) {
      update.fold_marks_vertical_mm = parseFoldMarksField(formData.get("foldMarksVertical"));
    }
    if (formData.has("fold")) update.fold = parseFoldField(formData.get("fold"));
    if (formData.has("tool_module")) update.tool_module = formData.get("tool_module") === "photos" ? "photos" : "design";
    if (formData.has("imposition_profile_id")) update.imposition_profile_id = String(formData.get("imposition_profile_id")) || null;
    if (formData.has("foldMarksHorizontal")) {
      update.fold_marks_horizontal_mm = parseFoldMarksField(formData.get("foldMarksHorizontal"));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors de l'envoi d'un fichier.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("templates")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible de mettre à jour le modèle.");
  return NextResponse.json({ template: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase
    .from("templates")
    .delete()
    .eq("id", params.id)
    .select();

  if (error) return serverError(error, "Impossible de supprimer le modèle.");
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Modèle introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

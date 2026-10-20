import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const field of STRING_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") body[field] = v;
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") body[field] = v === "" ? null : v;
  }
  for (const field of NUMERIC_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") body[field] = parseFloat(v);
  }
  for (const field of BOOLEAN_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") body[field] = v === "true";
  }

  const templateId = randomUUID();

  async function uploadOptionalFile(field: string): Promise<string | null> {
    const file = formData.get(field);
    if (!(file instanceof File) || file.size === 0) return null;
    const path = `${templateId}/${field}-${storageFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("overlays")
      .upload(path, buffer, { contentType: file.type || "image/png", upsert: true });
    if (uploadError) throw uploadError;
    return path;
  }

  let overlayPath: string | null;
  let maskPath: string | null;
  let shadingPath: string | null;
  let beautyShotXmlPath: string | null;
  try {
    overlayPath = await uploadOptionalFile("overlay");
    maskPath = await uploadOptionalFile("mask");
    shadingPath = await uploadOptionalFile("shading");
    // Bundle hérité (un seul par modèle) : TemplateForm ne l'envoie plus —
    // les mockups se créent via /api/template-mockups, qui en accepte
    // autant qu'on veut. Conservé pour les appels directs à l'API et pour
    // ne pas casser les modèles déjà configurés ainsi.
    beautyShotXmlPath = await uploadBeautyShotBundle(supabase.storage, formData, templateId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors de l'envoi d'un fichier.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("templates")
    .insert({
      id: templateId,
      ...body,
      overlay_path: overlayPath,
      mask_path: maskPath,
      shading_path: shadingPath,
      beauty_shot_xml_path: beautyShotXmlPath,
      beauty_shot_overlay_opacities: parseOverlayOpacitiesField(formData.get("beautyShotOverlayOpacities")),
      fold_marks_vertical_mm: parseFoldMarksField(formData.get("foldMarksVertical")),
      fold_marks_horizontal_mm: parseFoldMarksField(formData.get("foldMarksHorizontal")),
      fold: parseFoldField(formData.get("fold")),
      // Module de l'Outil Shopify : création de design, ou impression de photos.
      tool_module: formData.get("tool_module") === "photos" ? "photos" : "design",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { copyBeautyShotBundle } from "@/lib/templateBeautyShotUpload";
import { mockupFolder } from "@/lib/pdf/beautyShot";
import { listTemplateMockups } from "@/lib/templateMockups";
import { randomUUID as randomMockupId } from "crypto";
import type { Template } from "@/lib/types";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: source, error: sourceError } = await supabase
    .from("templates")
    .select("*")
    .eq("id", params.id)
    .single<Template>();
  if (sourceError || !source) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }

  const newId = randomUUID();

  // Le gabarit, le masque et l'ombrage (si présents) sont copiés dans
  // Storage sous le nouvel id, pour que chaque modèle reste propriétaire de
  // ses propres fichiers (modifier ou supprimer ceux de l'un n'affecte pas
  // l'autre).
  async function copyOptionalFile(sourcePath: string | null, fallbackName: string) {
    if (!sourcePath) return null;
    const filename = sourcePath.split("/").pop() ?? fallbackName;
    const newPath = `${newId}/${filename}`;
    const { error: copyError } = await supabase.storage.from("overlays").copy(sourcePath, newPath);
    if (copyError) throw copyError;
    return newPath;
  }

  let overlayPath: string | null;
  let maskPath: string | null;
  let shadingPath: string | null;
  let beautyShotXmlPath: string | null;
  try {
    overlayPath = await copyOptionalFile(source.overlay_path, "overlay");
    maskPath = await copyOptionalFile(source.mask_path, "mask");
    shadingPath = await copyOptionalFile(source.shading_path, "shading");
    beautyShotXmlPath = await copyBeautyShotBundle(supabase.storage, source.beauty_shot_xml_path, newId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors de la copie d'un fichier.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("templates")
    .insert({
      id: newId,
      name: `${source.name} (copie)`,
      category_id: source.category_id,
      sku_id: source.sku_id,
      width_mm: source.width_mm,
      height_mm: source.height_mm,
      bleed_mm: source.bleed_mm,
      safety_margin_x_mm: source.safety_margin_x_mm,
      safety_margin_y_mm: source.safety_margin_y_mm,
      print_margin_x_mm: source.print_margin_x_mm,
      print_margin_y_mm: source.print_margin_y_mm,
      dpi: source.dpi,
      logo_h_align: source.logo_h_align,
      logo_v_align: source.logo_v_align,
      logo_width_mm: source.logo_width_mm,
      logo_margin_x_mm: source.logo_margin_x_mm,
      logo_margin_y_mm: source.logo_margin_y_mm,
      two_sided: source.two_sided,
      logo_on_front: source.logo_on_front,
      logo_on_back: source.logo_on_back,
      allow_orientation_change: source.allow_orientation_change,
      overlay_path: overlayPath,
      mask_path: maskPath,
      shading_path: shadingPath,
      beauty_shot_xml_path: beautyShotXmlPath,
      beauty_shot_overlay_opacities: source.beauty_shot_overlay_opacities,
      fold_marks_vertical_mm: source.fold_marks_vertical_mm,
      fold_marks_horizontal_mm: source.fold_marks_horizontal_mm,
      fold: source.fold ?? null,
      tool_module: source.tool_module ?? "design",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Les mockups du modèle source (table template_mockups) suivent la copie :
  // chacun a son propre dossier de bundle, donc une nouvelle ligne + une
  // copie des fichiers vers le dossier du nouveau mockup.
  try {
    const sourceMockups = await listTemplateMockups(supabase, params.id);
    for (const mockup of sourceMockups) {
      const newMockupId = randomMockupId();
      const newXmlPath = await copyBeautyShotBundle(supabase.storage, mockup.xml_path, mockupFolder(newMockupId));
      if (!newXmlPath) continue;
      const { error: mockupError } = await supabase.from("template_mockups").insert({
        id: newMockupId,
        template_id: newId,
        name: mockup.name,
        sort_order: mockup.sort_order,
        xml_path: newXmlPath,
        overlay_opacities: mockup.overlay_opacities,
        created_by: user.id,
      });
      if (mockupError) throw new Error(mockupError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors de la copie des mockups.";
    return NextResponse.json({ error: `Modèle dupliqué, mais ses mockups n'ont pas suivi : ${message}` }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

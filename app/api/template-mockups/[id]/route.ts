import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { mockupFolder, parseOverlayOpacitiesField } from "@/lib/pdf/beautyShot";
import { parseMockupZoomValue, parsePositionValue, parseZoneMarginValue } from "@/lib/templateMockups";
import { uploadBeautyShotBundle } from "@/lib/templateBeautyShotUpload";
import type { TemplateMockup } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const formData = await request.formData();
  const update: Record<string, unknown> = {};

  const name = formData.get("name");
  if (typeof name === "string" && name.trim()) update.name = name.trim();

  if (formData.has("sortOrder")) {
    const sortOrder = Number(formData.get("sortOrder"));
    if (!Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "Ordre invalide." }, { status: 400 });
    }
    update.sort_order = Math.round(sortOrder);
  }

  // Remplacer/compléter le bundle : mêmes champs qu'à la création. Le XML
  // déjà stocké sert de référence quand seules des images sont renvoyées
  // (voir uploadBeautyShotBundle).
  const hasBundleFields =
    formData.get("beautyShotXml") instanceof File ||
    formData.getAll("beautyShotImages").some((f) => f instanceof File && f.size > 0);
  if (hasBundleFields) {
    const { data: existing } = await supabase
      .from("template_mockups")
      .select("xml_path")
      .eq("id", params.id)
      .maybeSingle();
    try {
      const xmlPath = await uploadBeautyShotBundle(
        supabase.storage,
        formData,
        mockupFolder(params.id),
        (existing as Pick<TemplateMockup, "xml_path"> | null)?.xml_path ?? null
      );
      if (xmlPath) update.xml_path = xmlPath;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erreur lors de l'envoi du bundle." },
        { status: 400 }
      );
    }
  }

  // Cadrage du visuel : chaque champ n'est touché que s'il est envoyé, pour
  // que l'interface puisse n'en modifier qu'un à la fois.
  if (formData.has("positionX")) {
    update.position_x = parsePositionValue(formData.get("positionX"));
  }
  if (formData.has("positionY")) {
    update.position_y = parsePositionValue(formData.get("positionY"));
  }
  if (formData.has("zoom")) {
    update.zoom = parseMockupZoomValue(formData.get("zoom"));
  }
  if (formData.has("marginLeft")) {
    update.margin_left = parseZoneMarginValue(formData.get("marginLeft"));
  }
  if (formData.has("marginRight")) {
    update.margin_right = parseZoneMarginValue(formData.get("marginRight"));
  }
  if (formData.has("marginTop")) {
    update.margin_top = parseZoneMarginValue(formData.get("marginTop"));
  }
  if (formData.has("marginBottom")) {
    update.margin_bottom = parseZoneMarginValue(formData.get("marginBottom"));
  }

  if (formData.has("beautyShotOverlayOpacities")) {
    update.overlay_opacities = parseOverlayOpacitiesField(formData.get("beautyShotOverlayOpacities"));
  }

  const { data, error } = await supabase
    .from("template_mockups")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible de mettre à jour le visuel du modèle.");
  return NextResponse.json({ mockup: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  // Comme pour les thèmes, les fichiers du bucket ne sont pas supprimés
  // (voir app/api/themes/[id]/route.ts) — seule la ligne disparaît.
  const { data, error } = await supabase.from("template_mockups").delete().eq("id", params.id).select();

  if (error) return serverError(error, "Impossible de supprimer le visuel du modèle.");
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Mockup introuvable ou suppression non autorisée." }, { status: 404 });
  }

  // Si ce mockup était la reprise du bundle hérité du modèle (migration
  // 0049), on efface aussi la colonne : sinon resolveMockupBundle y
  // retomberait et le mockup « supprimé » réapparaîtrait — d'autant que le
  // formulaire du modèle ne permet plus de vider cette colonne.
  const deleted = data[0] as { template_id: string; xml_path: string };
  const { data: template } = await supabase
    .from("templates")
    .select("beauty_shot_xml_path")
    .eq("id", deleted.template_id)
    .maybeSingle();
  const legacyPath = (template as { beauty_shot_xml_path: string | null } | null)?.beauty_shot_xml_path;
  if (legacyPath && legacyPath === deleted.xml_path) {
    await supabase
      .from("templates")
      .update({ beauty_shot_xml_path: null, beauty_shot_overlay_opacities: null })
      .eq("id", deleted.template_id);
  }

  return NextResponse.json({ ok: true });
}

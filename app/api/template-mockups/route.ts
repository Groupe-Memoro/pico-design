import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { mockupFolder, parseBeautyShotXml, parseOverlayOpacitiesField } from "@/lib/pdf/beautyShot";
import { loadMaskBounds } from "@/lib/pdf/beautyShotBundle";
import {
  listTemplateMockups,
  parseMockupZoomValue,
  parsePositionValue,
  parseZoneMarginValue,
} from "@/lib/templateMockups";
import { uploadBeautyShotBundle } from "@/lib/templateBeautyShotUpload";

/**
 * CRUD des mockups d'un modèle (voir
 * supabase/migrations/0049_template_mockups.sql) : un modèle peut en avoir
 * plusieurs, chacun étant un bundle « beauty shot » complet (son XML + ses
 * images), pour montrer le même produit sous plusieurs angles.
 *
 * Chaque bundle vit dans son propre dossier (`mockups/<id>/`), contrairement
 * au bundle hérité posé sur le modèle (`<templateId>/`) qui ne pouvait en
 * contenir qu'un — voir mockupFolder/beautyShotFolderOf.
 */
export async function GET(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const templateId = new URL(request.url).searchParams.get("templateId");
  if (!templateId) return NextResponse.json({ error: "Modèle manquant." }, { status: 400 });

  const mockups = await listTemplateMockups(supabase, templateId);

  // Les surcouches (leur nombre et leur mode de fusion) ne vivent que dans le
  // XML : on les renvoie pour que l'écran d'admin puisse nommer chaque
  // curseur d'intensité (« multiply », « overlay »…) plutôt qu'afficher une
  // liste anonyme. Seul le XML est téléchargé, pas les images du bundle.
  const admin = createAdminSupabaseClient();
  const withOverlays = await Promise.all(
    mockups.map(async (mockup) => {
      try {
        const { data } = await admin.storage.from("overlays").download(mockup.xml_path);
        if (!data) return { ...mockup, overlays: [], maskBounds: null };
        const config = parseBeautyShotXml(await data.text());
        const overlays = config.overlays.map((o) => ({ name: o.assetName, blendMode: o.blendMode }));

        // Bords du produit dans son masque : l'écran d'admin s'en sert pour
        // recaler les marges de zone d'un clic sur un mockup existant.
        const maskBounds = await loadMaskBounds(admin.storage, mockup.xml_path);
        return { ...mockup, overlays, maskBounds };
      } catch {
        return { ...mockup, overlays: [], maskBounds: null };
      }
    })
  );

  return NextResponse.json({ mockups: withOverlays });
}

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const formData = await request.formData();
  const templateId = formData.get("templateId");
  const name = formData.get("name");

  if (typeof templateId !== "string" || !templateId) {
    return NextResponse.json({ error: "Modèle manquant." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nom manquant." }, { status: 400 });
  }

  const mockupId = randomUUID();
  let xmlPath: string | null;
  try {
    // Mêmes champs que le bundle hérité ("beautyShotXml" + "beautyShotImages"
    // répété), mais déposés dans le dossier de CE mockup.
    xmlPath = await uploadBeautyShotBundle(supabase.storage, formData, mockupFolder(mockupId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors de l'envoi du bundle." },
      { status: 400 }
    );
  }
  if (!xmlPath) {
    return NextResponse.json({ error: "Le fichier XML du bundle mockup est requis." }, { status: 400 });
  }

  // Marges de zone calées d'office sur le masque, c.-à-d. sur le produit :
  // c'est ce qui garantit que le visuel a la hauteur du produit (et pas celle
  // de toute la scène) dès la création, sans réglage manuel. Un mockup dont
  // le bundle n'a pas de masque garde des marges nulles.
  const bounds = await loadMaskBounds(supabase.storage, xmlPath);
  // Arrondi vers l'extérieur, comme « Caler sur le produit » : au plus proche,
  // le visuel pouvait commencer en dedans et laisser un liseré le long du bord.
  const floor2 = (n: number) => Math.floor(n * 100) / 100;
  const margins = {
    margin_left: parseZoneMarginValue(formData.get("marginLeft") ?? (bounds ? String(floor2(bounds.left)) : null)),
    margin_right: parseZoneMarginValue(formData.get("marginRight") ?? (bounds ? String(floor2(bounds.right)) : null)),
    margin_top: parseZoneMarginValue(formData.get("marginTop") ?? (bounds ? String(floor2(bounds.top)) : null)),
    margin_bottom: parseZoneMarginValue(formData.get("marginBottom") ?? (bounds ? String(floor2(bounds.bottom)) : null)),
  };

  // Placé en dernier par défaut, pour ne pas bousculer l'ordre existant.
  const existing = await listTemplateMockups(supabase, templateId);
  const sortOrder = existing.reduce((max, m) => Math.max(max, m.sort_order), -1) + 1;

  const { data, error } = await supabase
    .from("template_mockups")
    .insert({
      id: mockupId,
      template_id: templateId,
      name: name.trim(),
      sort_order: sortOrder,
      xml_path: xmlPath,
      position_x: parsePositionValue(formData.get("positionX")),
      position_y: parsePositionValue(formData.get("positionY")),
      zoom: parseMockupZoomValue(formData.get("zoom")),
      ...margins,
      overlay_opacities: parseOverlayOpacitiesField(formData.get("beautyShotOverlayOpacities")),
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer le visuel du modèle.");
  return NextResponse.json({ mockup: data });
}

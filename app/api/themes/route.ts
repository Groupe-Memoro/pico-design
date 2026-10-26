import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseThemeSlotsField } from "@/lib/pdf/theme";
import { MAX_THEME_SLOTS } from "@/lib/themeShapes";
import { storageFileName } from "@/lib/storageName";
import { parseTextZonesField } from "@/lib/themeText";
import { parseThemeGuidesField } from "@/lib/variableData/snap";

/**
 * CRUD des Thèmes (voir supabase/migrations/0046_themes.sql et
 * lib/pdf/theme.ts) — un graphisme préfait, attribué à un modèle précis,
 * affiché par-dessus les photos du client. `GET` optionnellement filtré
 * par `templateId` (utilisé par Design Shopify, qui n'a besoin que des
 * thèmes du modèle en cours, voir DesignTypePicker).
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const templateId = new URL(request.url).searchParams.get("templateId");
  let query = supabase.from("themes").select("*").order("name", { ascending: true });
  if (templateId) query = query.eq("template_id", templateId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ themes: data });
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const formData = await request.formData();
  const templateId = formData.get("templateId");
  const name = formData.get("name");
  const overlayFile = formData.get("overlay");
  const backgroundFile = formData.get("background");
  const slots = parseThemeSlotsField(formData.get("slots"));
  const textZones = parseTextZonesField(formData.get("textZones")) ?? [];
  const guides = parseThemeGuidesField(formData.get("guides")) ?? [];

  if (typeof templateId !== "string" || !templateId) {
    return NextResponse.json({ error: "Modèle manquant." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nom manquant." }, { status: 400 });
  }
  if (!(overlayFile instanceof File) || overlayFile.size === 0) {
    return NextResponse.json({ error: "Graphisme manquant." }, { status: 400 });
  }
  if (!slots) {
    return NextResponse.json({ error: `Emplacements invalides (1 à ${MAX_THEME_SLOTS} attendus).` }, { status: 400 });
  }

  const themeId = randomUUID();
  const overlayPath = `themes/${themeId}/overlay-${storageFileName(overlayFile.name)}`;
  const buffer = Buffer.from(await overlayFile.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("overlays")
    .upload(overlayPath, buffer, { contentType: overlayFile.type || "image/png", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Fond facultatif (voir 0068_theme_background.sql) : la colonne n'est
  // écrite que s'il y en a un, pour qu'un thème sans fond reste créable
  // avant la migration.
  let backgroundPath: string | null = null;
  if (backgroundFile instanceof File && backgroundFile.size > 0) {
    backgroundPath = `themes/${themeId}/background-${storageFileName(backgroundFile.name)}`;
    const { error: backgroundError } = await supabase.storage
      .from("overlays")
      .upload(backgroundPath, Buffer.from(await backgroundFile.arrayBuffer()), {
        contentType: backgroundFile.type || "image/png",
        upsert: true,
      });
    if (backgroundError) {
      return NextResponse.json({ error: backgroundError.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("themes")
    .insert({
      id: themeId,
      template_id: templateId,
      name: name.trim(),
      overlay_path: overlayPath,
      ...(backgroundPath ? { background_path: backgroundPath } : {}),
      slots,
      // Écrite seulement s'il y en a (voir 0076_theme_text_zones.sql).
      ...(textZones.length > 0 ? { text_zones: textZones } : {}),
      // Idem pour les repères (voir 0083_theme_guides.sql).
      ...(guides.length > 0 ? { guides } : {}),
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ theme: data });
}

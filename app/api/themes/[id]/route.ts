import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseThemeSlotsField } from "@/lib/pdf/theme";
import { MAX_THEME_SLOTS } from "@/lib/themeShapes";
import { storageFileName } from "@/lib/storageName";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const formData = await request.formData();
  const update: Record<string, unknown> = {};

  const templateId = formData.get("templateId");
  if (typeof templateId === "string" && templateId) update.template_id = templateId;

  const name = formData.get("name");
  if (typeof name === "string" && name.trim()) update.name = name.trim();

  if (formData.has("slots")) {
    const slots = parseThemeSlotsField(formData.get("slots"));
    if (!slots) {
      return NextResponse.json({ error: `Emplacements invalides (1 à ${MAX_THEME_SLOTS} attendus).` }, { status: 400 });
    }
    update.slots = slots;
  }

  const overlayFile = formData.get("overlay");
  if (overlayFile instanceof File && overlayFile.size > 0) {
    const overlayPath = `themes/${params.id}/overlay-${storageFileName(overlayFile.name)}`;
    const buffer = Buffer.from(await overlayFile.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("overlays")
      .upload(overlayPath, buffer, { contentType: overlayFile.type || "image/png", upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    update.overlay_path = overlayPath;
  }

  // Fond facultatif (voir 0068_theme_background.sql) : un nouveau fichier le
  // remplace, `removeBackground` le retire.
  const backgroundFile = formData.get("background");
  if (backgroundFile instanceof File && backgroundFile.size > 0) {
    const backgroundPath = `themes/${params.id}/background-${storageFileName(backgroundFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("overlays")
      .upload(backgroundPath, Buffer.from(await backgroundFile.arrayBuffer()), {
        contentType: backgroundFile.type || "image/png",
        upsert: true,
      });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    update.background_path = backgroundPath;
  } else if (formData.get("removeBackground") === "true") {
    update.background_path = null;
  }

  const { data, error } = await supabase
    .from("themes")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ theme: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase.from("themes").delete().eq("id", params.id).select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Thème introuvable ou suppression non autorisée." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

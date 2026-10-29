import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { parseZones, type StickerTemplate } from "@/lib/stickers/types";
import { STICKERS_BUCKET, StickerAssetError, applyStickerAssets } from "@/lib/stickers/assets";
import { stickerSheetLayout } from "@/lib/stickers/layout";
import type { ImpositionCutter, ImpositionSheet } from "@/lib/types";

export const runtime = "nodejs";

async function currentUser() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Enregistre un modèle : nom, taille, zones (JSON) et fichiers (multipart).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: current } = await supabase
    .from("sticker_templates")
    .select("*")
    .eq("id", params.id)
    .single<StickerTemplate>();
  if (!current) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });

  const form = await request.formData();
  const name = String(form.get("name") ?? current.name).replace(/\s+/g, " ").trim().slice(0, 120);
  let width = Number(form.get("width_mm") ?? current.width_mm);
  let height = Number(form.get("height_mm") ?? current.height_mm);

  // Profil Graphtec : la planche prend la taille de sa zone utile (feuille
  // moins marges). Champ vide = plus de profil, la planche garde sa taille.
  let cutterId = current.cutter_id;
  if (form.has("cutter_id")) cutterId = String(form.get("cutter_id")) || null;
  if (cutterId) {
    const { data: cutter } = await supabase
      .from("imposition_cutters")
      .select("*")
      .eq("id", cutterId)
      .eq("machine", "graphtec")
      .single<ImpositionCutter>();
    if (!cutter) return NextResponse.json({ error: "Profil Graphtec introuvable." }, { status: 404 });
    if (!cutter.sheet_id) {
      return NextResponse.json({ error: "Ce profil Graphtec n'a pas de format de papier." }, { status: 400 });
    }
    const { data: sheet } = await supabase
      .from("imposition_sheets")
      .select("*")
      .eq("id", cutter.sheet_id)
      .single<ImpositionSheet>();
    if (!sheet) return NextResponse.json({ error: "La feuille du profil est introuvable." }, { status: 404 });
    const { area } = stickerSheetLayout({ width_mm: width, height_mm: height }, cutter, sheet);
    width = Math.round(area.width * 100) / 100;
    height = Math.round(area.height * 100) / 100;
  }
  if (!name) return NextResponse.json({ error: "Donnez un nom au modèle." }, { status: 400 });
  if (!(width > 0 && width <= 2000) || !(height > 0 && height <= 2000)) {
    return NextResponse.json({ error: "La taille de la feuille est invalide." }, { status: 400 });
  }
  let zones = current.zones;
  if (form.has("zones")) {
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("zones")));
    } catch {
      raw = null;
    }
    const parsed = parseZones(raw, width, height);
    if (!parsed) {
      return NextResponse.json(
        { error: "Zones invalides : chacune doit avoir une taille et rester à l'intérieur de la feuille." },
        { status: 400 }
      );
    }
    zones = parsed;
  }

  let paths;
  try {
    paths = await applyStickerAssets(createAdminSupabaseClient().storage, current.id, form, current);
  } catch (err) {
    const status = err instanceof StickerAssetError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Enregistrement impossible." }, { status });
  }

  const { data, error } = await supabase
    .from("sticker_templates")
    .update({
      name,
      width_mm: width,
      height_mm: height,
      cutter_id: cutterId,
      zones,
      ...paths,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .select()
    .single();
  if (error) return serverError(error, "Impossible de mettre à jour le sticker.");
  return NextResponse.json({ template: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase
    .from("sticker_templates")
    .delete()
    .eq("id", params.id)
    .select("artwork_path, marks_path, guide_path");
  if (error) return serverError(error, "Impossible de supprimer le sticker.");
  if (!data || data.length === 0) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  const files = data
    .flatMap((row) => [row.artwork_path, row.marks_path, row.guide_path])
    .filter((p): p is string => Boolean(p));
  if (files.length > 0) await createAdminSupabaseClient().storage.from(STICKERS_BUCKET).remove(files);
  return NextResponse.json({ ok: true });
}

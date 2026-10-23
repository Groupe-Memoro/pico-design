import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { parseCardSample, parseCardZones, type StudentCardTemplate } from "@/lib/studentCards/types";
import { CardAssetError, STUDENT_CARDS_BUCKET, applyCardBackgrounds } from "@/lib/studentCards/assets";

export const runtime = "nodejs";

async function currentUser() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function parseJson(value: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

// Enregistre un modèle : nom, école, format, zones et aperçu (JSON), fonds (multipart).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: current } = await supabase
    .from("student_card_templates")
    .select("*")
    .eq("id", params.id)
    .single<StudentCardTemplate>();
  if (!current) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });

  const form = await request.formData();
  const name = form.has("name") ? clean(form.get("name"), 120) : current.name;
  const school = form.has("school") ? clean(form.get("school"), 120) : current.school;
  const width = form.has("width_mm") ? Number(form.get("width_mm")) : Number(current.width_mm);
  const height = form.has("height_mm") ? Number(form.get("height_mm")) : Number(current.height_mm);
  const twoSided = form.has("two_sided") ? form.get("two_sided") === "true" : current.two_sided;
  if (!name) return NextResponse.json({ error: "Donnez un nom au modèle." }, { status: 400 });
  if (!(width > 0 && width <= 300) || !(height > 0 && height <= 300)) {
    return NextResponse.json({ error: "Le format de la carte est invalide." }, { status: 400 });
  }

  let zones = current.zones;
  if (form.has("zones")) {
    const parsed = parseCardZones(parseJson(form.get("zones")), width, height);
    if (!parsed) {
      return NextResponse.json(
        { error: "Zones invalides : chacune doit avoir une taille et rester à l'intérieur de la carte." },
        { status: 400 }
      );
    }
    zones = parsed;
  }
  const sample = form.has("sample") ? parseCardSample(parseJson(form.get("sample"))) : current.sample;
  const photoColumn = form.has("photo_column") ? clean(form.get("photo_column"), 100) || null : current.photo_column;

  let paths;
  try {
    paths = await applyCardBackgrounds(createAdminSupabaseClient().storage, current.id, form, current);
  } catch (err) {
    const status = err instanceof CardAssetError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Enregistrement impossible." }, { status });
  }

  const { data, error } = await supabase
    .from("student_card_templates")
    .update({
      name,
      school,
      width_mm: width,
      height_mm: height,
      two_sided: twoSided,
      zones,
      sample,
      photo_column: photoColumn,
      ...paths,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase
    .from("student_card_templates")
    .delete()
    .eq("id", params.id)
    .select("front_path, back_path");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  const files = data.flatMap((row) => [row.front_path, row.back_path]).filter((p): p is string => Boolean(p));
  if (files.length > 0) await createAdminSupabaseClient().storage.from(STUDENT_CARDS_BUCKET).remove(files);
  return NextResponse.json({ ok: true });
}

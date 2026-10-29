import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { parseCutterForm } from "@/lib/imposition/cutters";
import { CutterAssetError, applyCutterAssets } from "@/lib/imposition/cutterAssets";
import type { ImpositionCutter } from "@/lib/types";
import { serverError, requireApiUser } from "@/lib/api";

export const runtime = "nodejs";

// Modifie un profil : ses champs, et ses fichiers (remplacés ou retirés, voir applyCutterAssets).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const form = await request.formData();
  const parsed = parseCutterForm(form);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data: current } = await supabase
    .from("imposition_cutters")
    .select("*")
    .eq("id", params.id)
    .single<ImpositionCutter>();
  if (!current) return NextResponse.json({ error: "Profil introuvable." }, { status: 404 });

  let paths;
  try {
    paths = await applyCutterAssets(createAdminSupabaseClient().storage, current.id, form, current);
  } catch (err) {
    const status = err instanceof CutterAssetError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Enregistrement impossible." }, { status });
  }

  const { data, error } = await supabase
    .from("imposition_cutters")
    .update({ ...parsed.fields, ...paths })
    .eq("id", current.id)
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer la découpe.");
  return NextResponse.json({ cutter: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase
    .from("imposition_cutters")
    .delete()
    .eq("id", params.id)
    .select("marks_path, guide_path");
  if (error) return serverError(error, "Impossible de supprimer la découpe.");
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Profil introuvable ou suppression non autorisée." }, { status: 404 });
  }
  const files = data.flatMap((row) => [row.marks_path, row.guide_path]).filter((p): p is string => Boolean(p));
  if (files.length > 0) await createAdminSupabaseClient().storage.from("imposition").remove(files);
  return NextResponse.json({ ok: true });
}

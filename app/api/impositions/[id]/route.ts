import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { ImpositionError } from "@/lib/imposition/build";
import { saveImposition } from "@/lib/imposition/persist";
import { imposedPdfPath, sourcesDir, type SavedImposition } from "@/lib/imposition/saved";

export const runtime = "nodejs";
export const maxDuration = 300; // plusieurs feuilles (fichier de plusieurs pages)

async function currentUser() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Modifie une imposition : le PDF est régénéré et remplace l'ancien.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: existing } = await supabase
    .from("impositions")
    .select("*")
    .eq("id", params.id)
    .single<SavedImposition>();
  if (!existing) return NextResponse.json({ error: "Imposition introuvable." }, { status: 404 });

  try {
    const saved = await saveImposition(await request.formData(), params.id, user.id, existing);
    return NextResponse.json({ imposition: saved });
  } catch (err) {
    if (err instanceof ImpositionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors de l'enregistrement." }, { status: 500 });
  }
}

// Supprime l'imposition, son PDF et les PDF téléversés qui lui étaient rattachés.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabase.from("impositions").delete().eq("id", params.id).select("config");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Imposition introuvable ou suppression non autorisée." }, { status: 404 });
  }

  // La ligne est supprimée : le nettoyage du stockage est fait au mieux.
  const admin = createAdminSupabaseClient();
  const paths = [imposedPdfPath(params.id)];
  const { data: stored } = await admin.storage.from("imposition").list(sourcesDir(params.id), { limit: 1000 });
  for (const f of stored ?? []) paths.push(`${sourcesDir(params.id)}/${f.name}`);
  await admin.storage.from("imposition").remove(paths);
  return NextResponse.json({ ok: true });
}

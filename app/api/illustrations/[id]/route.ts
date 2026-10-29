import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { ILLUSTRATIONS_BUCKET, cleanIllustrationName } from "@/lib/illustrations";
import { serverError, requireApiUser } from "@/lib/api";

export const runtime = "nodejs";

// Renomme une illustration.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
  const clean = cleanIllustrationName(name);
  if (!clean) return NextResponse.json({ error: "Donnez un nom à l'illustration." }, { status: 400 });

  const { data, error } = await supabase
    .from("illustrations")
    .update({ name: clean })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer l'illustration.");
  return NextResponse.json({ illustration: data });
}

// Retire une illustration de la banque, avec son fichier. Les designs déjà
// enregistrés n'en dépendent pas : le client a renvoyé le fichier avec son design.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase.from("illustrations").delete().eq("id", params.id).select("file_path");
  if (error) return serverError(error, "Impossible de supprimer l'illustration.");
  if (!data || data.length === 0) return NextResponse.json({ error: "Illustration introuvable." }, { status: 404 });
  await createAdminSupabaseClient()
    .storage.from(ILLUSTRATIONS_BUCKET)
    .remove(data.map((row) => row.file_path));
  return NextResponse.json({ ok: true });
}

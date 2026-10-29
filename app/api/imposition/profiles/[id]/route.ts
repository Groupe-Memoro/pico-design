import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseProfileBody } from "@/lib/imposition/profiles";
import { serverError } from "@/lib/api";

async function currentUser() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Modifie un profil d'imposition.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const parsed = parseProfileBody(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data, error } = await supabase.from("imposition_profiles").update(parsed.row).eq("id", params.id).select().single();
  if (error) return serverError(error, "Impossible d'enregistrer le profil d'imposition.");
  return NextResponse.json({ profile: data });
}

// Supprime un profil : les modèles qui l'utilisaient n'en ont plus (on delete set null).
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { error } = await supabase.from("imposition_profiles").delete().eq("id", params.id);
  if (error) return serverError(error, "Impossible de supprimer le profil d'imposition.");
  return NextResponse.json({ ok: true });
}

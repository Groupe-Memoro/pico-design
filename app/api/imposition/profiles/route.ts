import { NextResponse } from "next/server";
import { parseProfileBody } from "@/lib/imposition/profiles";
import { serverError, requireApiUser } from "@/lib/api";

// Crée un profil d'imposition (voir 0078_imposition_profiles.sql).
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const parsed = parseProfileBody(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data, error } = await supabase
    .from("imposition_profiles")
    .insert({ ...parsed.row, created_by: user.id })
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer le profil d'imposition.");
  return NextResponse.json({ profile: data });
}

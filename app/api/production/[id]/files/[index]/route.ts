import { requireApiUser } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Télécharge un PDF imposé d'une mise en production (voir app/api/production).
export async function GET(_request: Request, { params }: { params: { id: string; index: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data: batch } = await supabase.from("production_batches").select("files").eq("id", params.id).maybeSingle();
  const file = (batch?.files as { name: string; path: string }[] | undefined)?.[Number(params.index)];
  if (!file) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  // Trop lourd pour passer dans la réponse (Vercel plafonne à 4,5 Mo) : on
  // redirige vers une adresse signée du stockage, qui force le téléchargement.
  const { data, error } = await createAdminSupabaseClient()
    .storage.from("outputs")
    .createSignedUrl(file.path, 60 * 10, { download: `${file.name}.pdf` });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}

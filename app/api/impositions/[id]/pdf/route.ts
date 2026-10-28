import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { pdfDownloadName } from "@/lib/imposition/saved";

export const runtime = "nodejs";

// PDF d'une imposition enregistrée : affiché dans le navigateur, ou téléchargé avec ?download=1.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: row } = await supabase
    .from("impositions")
    .select("name, pdf_path")
    .eq("id", params.id)
    .single<{ name: string; pdf_path: string }>();
  if (!row) return NextResponse.json({ error: "Imposition introuvable." }, { status: 404 });

  // Trop lourd pour passer dans la réponse (Vercel plafonne à 4,5 Mo) : on
  // redirige vers une adresse signée du stockage. Sans `download`, le stockage
  // sert le PDF en ligne (l'aperçu le lit via fetch, voir ImpositionsTable).
  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data, error } = await createAdminSupabaseClient()
    .storage.from("imposition")
    .createSignedUrl(row.pdf_path, 60 * 10, download ? { download: pdfDownloadName(row.name) } : undefined);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "PDF introuvable." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}

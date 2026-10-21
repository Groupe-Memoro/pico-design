import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { contentDisposition } from "@/lib/contentDisposition";

export const runtime = "nodejs";

// Télécharge un PDF imposé d'une mise en production (voir app/api/production).
export async function GET(_request: Request, { params }: { params: { id: string; index: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: batch } = await supabase.from("production_batches").select("files").eq("id", params.id).maybeSingle();
  const file = (batch?.files as { name: string; path: string }[] | undefined)?.[Number(params.index)];
  if (!file) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  const { data, error } = await createAdminSupabaseClient().storage.from("outputs").download(file.path);
  if (error || !data) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  return new NextResponse(new Uint8Array(await data.arrayBuffer()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(`${file.name}.pdf`),
      "Cache-Control": "private, no-store",
    },
  });
}

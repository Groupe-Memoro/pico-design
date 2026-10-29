import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Crée un modèle d'autocollants vide (nom et taille de la feuille) : ses
// fichiers et ses zones s'ajoutent ensuite, dans l'écran du modèle.
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const width = Number(body.width_mm);
  const height = Number(body.height_mm);
  if (!name) return NextResponse.json({ error: "Donnez un nom au modèle." }, { status: 400 });
  if (!(width > 0 && width <= 2000) || !(height > 0 && height <= 2000)) {
    return NextResponse.json({ error: "La taille de la feuille est invalide." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sticker_templates")
    .insert({ name, width_mm: width, height_mm: height, created_by: user.id })
    .select("id")
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer le sticker.");
  return NextResponse.json({ id: (data as { id: string }).id });
}

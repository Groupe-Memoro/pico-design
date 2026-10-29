import { NextResponse } from "next/server";
import { parseSheetBody } from "@/lib/imposition/presets";
import { serverError, requireApiUser } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const fields = parseSheetBody(await request.json().catch(() => null));
  if (!fields) {
    return NextResponse.json({ error: "La largeur et la hauteur sont requises." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("imposition_sheets")
    .update(fields)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer la feuille.");
  return NextResponse.json({ sheet: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase.from("imposition_sheets").delete().eq("id", params.id).select();
  if (error) return serverError(error, "Impossible de supprimer la feuille.");
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Feuille introuvable ou suppression non autorisée." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

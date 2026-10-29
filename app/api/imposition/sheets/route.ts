import { NextResponse } from "next/server";
import { parseSheetBody } from "@/lib/imposition/presets";
import { serverError, requireApiUser } from "@/lib/api";

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const fields = parseSheetBody(await request.json().catch(() => null));
  if (!fields) {
    return NextResponse.json({ error: "La largeur et la hauteur sont requises." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("imposition_sheets")
    .insert({ ...fields, created_by: user.id })
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer la feuille.");
  return NextResponse.json({ sheet: data });
}

import { NextResponse } from "next/server";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("categories")
    .update({ name })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer la catégorie.");
  return NextResponse.json({ category: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", params.id)
    .select();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cette catégorie est utilisée par au moins un modèle et ne peut pas être supprimée." },
        { status: 409 }
      );
    }
    return serverError(error, "Impossible de supprimer la catégorie.");
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Catégorie introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

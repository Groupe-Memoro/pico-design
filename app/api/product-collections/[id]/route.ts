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
    .from("product_collections")
    .update({ name })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer la collection de produits.");
  return NextResponse.json({ collection: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  // Les produits de la collection ne sont pas supprimés : leur collection_id
  // repasse simplement à null (contrainte FK on delete set null).
  const { data, error } = await supabase
    .from("product_collections")
    .delete()
    .eq("id", params.id)
    .select();

  if (error) return serverError(error, "Impossible de supprimer la collection de produits.");
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Collection introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

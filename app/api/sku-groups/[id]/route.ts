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
    .from("sku_groups")
    .update({ name })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer le groupe de SKU.");
  return NextResponse.json({ skuGroup: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase
    .from("sku_groups")
    .delete()
    .eq("id", params.id)
    .select();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Ce groupe est utilisé par au moins un SKU et ne peut pas être supprimé." },
        { status: 409 }
      );
    }
    return serverError(error, "Impossible de supprimer le groupe de SKU.");
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Groupe introuvable ou suppression non autorisée." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

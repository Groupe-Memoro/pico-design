import { NextResponse } from "next/server";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const body = await readJson(request);
  const sku = typeof body?.sku === "string" ? body.sku.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const skuGroupId = typeof body?.sku_group_id === "string" ? body.sku_group_id.trim() : "";
  if (!sku || !name || !skuGroupId) {
    return NextResponse.json({ error: "Le SKU, le nom et le groupe sont requis." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("skus")
    .update({ sku, name, sku_group_id: skuGroupId })
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ce SKU existe déjà." }, { status: 409 });
    }
    return serverError(error, "Impossible d'enregistrer le SKU.");
  }
  return NextResponse.json({ sku: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase.from("skus").delete().eq("id", params.id).select();

  if (error) return serverError(error, "Impossible de supprimer le SKU.");
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "SKU introuvable ou suppression non autorisée." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

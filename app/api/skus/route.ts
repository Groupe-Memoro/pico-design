import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("skus").select("*").order("sku", { ascending: true });

  if (error) return serverError(error, "Impossible de charger le SKU.");
  return NextResponse.json({ skus: data });
}

export async function POST(request: Request) {
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
    .insert({ sku, name, sku_group_id: skuGroupId })
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

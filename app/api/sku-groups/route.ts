import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sku_groups")
    .select("*")
    .order("name", { ascending: true });

  if (error) return serverError(error, "Impossible de charger le groupe de SKU.");
  return NextResponse.json({ skuGroups: data });
}

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis." }, { status: 400 });
  }

  const { data, error } = await supabase.from("sku_groups").insert({ name }).select().single();

  if (error) return serverError(error, "Impossible d'enregistrer le groupe de SKU.");
  return NextResponse.json({ skuGroup: data });
}

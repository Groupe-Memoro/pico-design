import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { nextSortOrder } from "@/lib/nextSortOrder";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return serverError(error, "Impossible de charger les catégories.");
  return NextResponse.json({ categories: data });
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

  const sortOrder = await nextSortOrder(supabase, "categories");
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, sort_order: sortOrder })
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer la catégorie.");
  return NextResponse.json({ category: data });
}

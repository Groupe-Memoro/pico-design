import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { nextSortOrder } from "@/lib/nextSortOrder";
import { serverError, readJson, requireApiUser } from "@/lib/api";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("visual_collections")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return serverError(error, "Impossible de charger la collection de visuels.");
  return NextResponse.json({ collections: data });
}

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis." }, { status: 400 });
  }

  const sortOrder = await nextSortOrder(supabase, "visual_collections");
  const { data, error } = await supabase
    .from("visual_collections")
    .insert({ name, sort_order: sortOrder, created_by: user.id })
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer la collection de visuels.");
  return NextResponse.json({ collection: data });
}

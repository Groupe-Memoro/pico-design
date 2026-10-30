import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { themePartsColumns, themePartsFromForm } from "@/lib/themePartsForm";
import { themeParts } from "@/lib/themeParts";
import type { Theme, ThemeScope } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const formData = await request.formData();
  const update: Record<string, unknown> = {};

  const templateId = formData.get("templateId");
  if (typeof templateId === "string" && templateId) update.template_id = templateId;

  const name = formData.get("name");
  if (typeof name === "string" && name.trim()) update.name = name.trim();

  // Parties du thème (voir lib/themeParts.ts) : celles envoyées remplacent les
  // anciennes ; une partie sans nouveau fichier garde le sien.
  if (formData.has("parts")) {
    const { data: current, error: currentError } = await supabase.from("themes").select("*").eq("id", params.id).single<Theme>();
    if (currentError || !current) return NextResponse.json({ error: "Thème introuvable." }, { status: 404 });
    const scope: ThemeScope = formData.get("scope") === "panel" ? "panel" : "sheet";
    let parts;
    try {
      parts = await themePartsFromForm(supabase, params.id, formData, scope, themeParts(current));
    } catch (err) {
      return serverError(err, "Impossible d'enregistrer l'image du thème.");
    }
    if (typeof parts === "string") return NextResponse.json({ error: parts }, { status: 400 });
    Object.assign(update, themePartsColumns(parts, scope));
  }

  const { data, error } = await supabase
    .from("themes")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return serverError(error, "Impossible de mettre à jour le thème.");
  return NextResponse.json({ theme: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data, error } = await supabase.from("themes").delete().eq("id", params.id).select();

  if (error) return serverError(error, "Impossible de supprimer le thème.");
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Thème introuvable ou suppression non autorisée." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

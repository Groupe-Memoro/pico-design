import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { themePartsColumns, themePartsFromForm } from "@/lib/themePartsForm";
import type { ThemeScope } from "@/lib/types";

/**
 * CRUD des Thèmes (voir supabase/migrations/0046_themes.sql et
 * lib/pdf/theme.ts) — un graphisme préfait, attribué à un modèle précis,
 * affiché par-dessus les photos du client. `GET` optionnellement filtré
 * par `templateId` (utilisé par Design Shopify, qui n'a besoin que des
 * thèmes du modèle en cours, voir DesignTypePicker).
 */
export async function GET(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const templateId = new URL(request.url).searchParams.get("templateId");
  let query = supabase.from("themes").select("*").order("name", { ascending: true });
  if (templateId) query = query.eq("template_id", templateId);

  const { data, error } = await query;
  if (error) return serverError(error, "Impossible de charger les thèmes.");
  return NextResponse.json({ themes: data });
}

export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const formData = await request.formData();
  const templateId = formData.get("templateId");
  const name = formData.get("name");
  if (typeof templateId !== "string" || !templateId) {
    return NextResponse.json({ error: "Modèle manquant." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nom manquant." }, { status: 400 });
  }
  const scope: ThemeScope = formData.get("scope") === "panel" ? "panel" : "sheet";

  // Parties du thème (recto/verso ou volets, voir lib/themeParts.ts), chacune
  // avec son graphisme : nouveau thème, aucune partie existante.
  const themeId = randomUUID();
  let parts;
  try {
    parts = await themePartsFromForm(supabase, themeId, formData, scope, []);
  } catch (err) {
    return serverError(err, "Impossible d'enregistrer l'image du thème.");
  }
  if (typeof parts === "string") return NextResponse.json({ error: parts }, { status: 400 });

  const { data, error } = await supabase
    .from("themes")
    .insert({
      id: themeId,
      template_id: templateId,
      name: name.trim(),
      ...themePartsColumns(parts, scope),
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer le thème.");
  return NextResponse.json({ theme: data });
}

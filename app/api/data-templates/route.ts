import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Crée un gabarit à données variables sur un modèle existant : son fond et
// ses zones s'ajoutent ensuite, dans l'écran du gabarit.
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Donnez un nom au gabarit." }, { status: 400 });
  const { data: template } = await supabase
    .from("templates")
    .select("id, two_sided")
    .eq("id", String(body.template_id ?? ""))
    .single<{ id: string; two_sided: boolean }>();
  if (!template) return NextResponse.json({ error: "Choisissez un modèle." }, { status: 400 });

  const { data, error } = await supabase
    .from("data_templates")
    .insert({ name, template_id: template.id, two_sided: template.two_sided, created_by: user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: (data as { id: string }).id });
}

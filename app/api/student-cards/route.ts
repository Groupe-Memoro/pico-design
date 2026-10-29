import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Crée un modèle de carte vide (nom, école, format, recto-verso) : son fond
// et ses zones s'ajoutent ensuite, dans l'écran du modèle.
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(body.name, 120);
  const school = clean(body.school, 120);
  const width = Number(body.width_mm);
  const height = Number(body.height_mm);
  if (!name) return NextResponse.json({ error: "Donnez un nom au modèle." }, { status: 400 });
  if (!(width > 0 && width <= 300) || !(height > 0 && height <= 300)) {
    return NextResponse.json({ error: "Le format de la carte est invalide." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("student_card_templates")
    .insert({ name, school, width_mm: width, height_mm: height, two_sided: body.two_sided === true, created_by: user.id })
    .select("id")
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer la carte étudiante.");
  return NextResponse.json({ id: (data as { id: string }).id });
}

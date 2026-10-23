import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_CARDS_PER_RENDER, renderStudentCards, type CardInput } from "@/lib/studentCards/render";
import { STUDENT_CARDS_BUCKET } from "@/lib/studentCards/assets";
import type { StudentCardTemplate } from "@/lib/studentCards/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Un lot de cartes en PDF. Le navigateur envoie les élèves par lots (champ
 * `cards` : [{ row, photo, label }], `photo` nommant le fichier joint) et
 * assemble les PDF reçus. Les photos ne sont pas enregistrées : elles ne
 * servent qu'à ce rendu.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: template } = await supabase
    .from("student_card_templates")
    .select("*")
    .eq("id", params.id)
    .single<StudentCardTemplate>();
  if (!template) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });

  const form = await request.formData();
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("cards")));
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CARDS_PER_RENDER) {
    return NextResponse.json({ error: "Lot de cartes invalide." }, { status: 400 });
  }

  const cards: CardInput[] = [];
  for (const [i, c] of (raw as Record<string, unknown>[]).entries()) {
    const row: Record<string, string> = {};
    if (c.row && typeof c.row === "object") {
      for (const [k, v] of Object.entries(c.row as Record<string, unknown>).slice(0, 100)) {
        row[String(k).slice(0, 100)] = String(v ?? "").slice(0, 300);
      }
    }
    const file = typeof c.photo === "string" ? form.get(c.photo) : null;
    cards.push({
      row,
      photo: file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null,
      label: typeof c.label === "string" ? c.label.slice(0, 120) : `Carte ${i + 1}`,
    });
  }

  const storage = createAdminSupabaseClient().storage.from(STUDENT_CARDS_BUCKET);
  const load = async (path: string | null) => {
    const file = path ? (await storage.download(path)).data : null;
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  };
  try {
    const [front, back] = await Promise.all([load(template.front_path), load(template.two_sided ? template.back_path : null)]);
    const { pdf, warnings } = await renderStudentCards(template, { front, back }, cards);
    // Avertissements (photo illisible, code impossible) dans un en-tête :
    // bornés, un en-tête trop long ferait échouer la réponse.
    let shown = warnings.slice(0, 40);
    while (shown.length && encodeURIComponent(JSON.stringify(shown)).length > 6000) shown = shown.slice(0, -5);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "X-Card-Warnings": encodeURIComponent(JSON.stringify(shown)),
        "X-Card-Warning-Count": String(warnings.length),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Rendu impossible." }, { status: 500 });
  }
}

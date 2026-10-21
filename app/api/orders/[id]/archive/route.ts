import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Retire une commande de l'outil, ou l'y remet. Rien n'est supprimé : voir
// supabase/migrations/0063_orders_archived.sql.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { archived } = (await request.json().catch(() => ({}))) as { archived?: unknown };
  if (typeof archived !== "boolean") return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const archivedAt = archived ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("orders")
    // Retirer une commande, c'est l'avoir vue.
    .update(archived ? { archived_at: archivedAt, viewed_at: archivedAt } : { archived_at: archivedAt })
    .eq("id", params.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, archivedAt });
}

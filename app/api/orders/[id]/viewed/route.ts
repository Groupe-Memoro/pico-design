import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Marque une commande comme vue (ou de nouveau « nouvelle ») : voir
// supabase/migrations/0077_orders_viewed.sql et la pastille du menu.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { viewed } = (await request.json().catch(() => ({}))) as { viewed?: unknown };
  const viewedAt = viewed === false ? null : new Date().toISOString();
  const query = supabase.from("orders").update({ viewed_at: viewedAt }).eq("id", params.id);
  // Déjà vue : on garde la première date.
  const { data, error } = await (viewedAt ? query.is("viewed_at", null) : query).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, changed: (data?.length ?? 0) > 0 });
}

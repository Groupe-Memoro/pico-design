import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Marque une commande comme vue (ou de nouveau « nouvelle ») : voir
// supabase/migrations/0077_orders_viewed.sql et la pastille du menu.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { viewed } = (await request.json().catch(() => ({}))) as { viewed?: unknown };
  const viewedAt = viewed === false ? null : new Date().toISOString();
  const query = supabase.from("orders").update({ viewed_at: viewedAt }).eq("id", params.id);
  // Déjà vue : on garde la première date.
  const { data, error } = await (viewedAt ? query.is("viewed_at", null) : query).select("id");
  if (error) return serverError(error, "Impossible de mettre à jour la commande.");
  return NextResponse.json({ ok: true, changed: (data?.length ?? 0) > 0 });
}

import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Nombre de nouvelles commandes, pour la pastille du menu : celles que
 * personne n'a encore regardées (voir 0077_orders_viewed.sql) et non
 * retirées. Le compte est le même pour toute l'équipe.
 */
export async function GET() {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .is("viewed_at", null)
    .is("archived_at", null);
  if (error) return serverError(error, "Impossible de compter les nouvelles commandes.");
  return NextResponse.json({ count: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

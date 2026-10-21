import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Nombre de nouvelles commandes, pour la pastille du menu : celles que
 * personne n'a encore regardées (voir 0077_orders_viewed.sql) et non
 * retirées. Le compte est le même pour toute l'équipe.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .is("viewed_at", null)
    .is("archived_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

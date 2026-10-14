import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Lu par le bloc Liquid de la fiche produit, sur le domaine de la boutique.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

/**
 * Lot de l'impression de photos : les designs enregistrés ensemble (une photo
 * chacun) et leur quantité. Au retour sur Shopify, le bloc Liquid de la fiche
 * produit en fait une ligne de panier par photo (propriété « _design »).
 *
 * Public, comme l'aperçu du panier : l'identifiant du lot est un UUID
 * aléatoire, et seuls les identifiants et quantités sont servis — rien des
 * photos elles-mêmes.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ items: [] }, { status: 404, headers: CORS });
  const { data } = await createAdminSupabaseClient()
    .from("design_submissions")
    .select("id, quantity, created_at")
    .eq("batch_id", params.id)
    .order("created_at", { ascending: true });
  const items = ((data as { id: string; quantity: number }[]) ?? []).map((d) => ({ design: d.id, quantity: d.quantity }));
  return NextResponse.json({ items }, { status: items.length ? 200 : 404, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

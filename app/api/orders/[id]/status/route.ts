import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ALLOWED = ["recue", "en_production", "imprimee", "expediee"];

// Avancement en atelier d'une commande. Interne : il n'est jamais renvoyé
// vers Shopify, qui garde ses propres statuts de paiement et d'expédition.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { picoStatus } = (await request.json().catch(() => ({}))) as { picoStatus?: string };
  if (!picoStatus || !ALLOWED.includes(picoStatus)) {
    return NextResponse.json({ error: "Statut inconnu." }, { status: 400 });
  }

  const { error } = await supabase
    .from("orders")
    // Faire avancer une commande, c'est l'avoir vue (pastille du menu).
    .update({ pico_status: picoStatus, updated_at: new Date().toISOString(), viewed_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

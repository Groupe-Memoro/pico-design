import { requireApiUser, serverError } from "@/lib/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED = ["recue", "en_production", "imprimee", "expediee"];

// Avancement en atelier d'une commande. Interne : il n'est jamais renvoyé
// vers Shopify, qui garde ses propres statuts de paiement et d'expédition.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { picoStatus } = (await request.json().catch(() => ({}))) as { picoStatus?: string };
  if (!picoStatus || !ALLOWED.includes(picoStatus)) {
    return NextResponse.json({ error: "Statut inconnu." }, { status: 400 });
  }

  const { error } = await supabase
    .from("orders")
    // Faire avancer une commande, c'est l'avoir vue (pastille du menu).
    .update({ pico_status: picoStatus, updated_at: new Date().toISOString(), viewed_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return serverError(error, "Impossible de mettre à jour le statut.");
  return NextResponse.json({ ok: true });
}

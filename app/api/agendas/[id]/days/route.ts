import { NextResponse } from "next/server";
import { jsonError, sessionClient, touchAgenda } from "@/lib/agendas/server";
import { DAY_KINDS } from "@/lib/agendas/types";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

const isoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Journées spéciales : `set` marque des dates (type et libellé ; une plage
 * comme la relâche arrive date par date), `clear` les remet en jours normaux.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as { set?: unknown; clear?: unknown };
  const set = (Array.isArray(body.set) ? body.set : [])
    .map((raw) => (raw ?? {}) as Record<string, unknown>)
    .filter((d) => isoDate(d.day) && DAY_KINDS.some((k) => k.kind === d.kind))
    .map((d) => ({
      agenda_id: params.id,
      day: d.day as string,
      kind: d.kind as string,
      label: typeof d.label === "string" ? d.label.trim().slice(0, 80) : "",
    }));
  const clear = (Array.isArray(body.clear) ? body.clear : []).filter(isoDate);
  if (set.length + clear.length > 800) return jsonError("Trop de dates en un envoi.");

  if (clear.length > 0) {
    const { error } = await supabase.from("agenda_days").delete().eq("agenda_id", params.id).in("day", clear);
    if (error) return serverError(error, "Impossible d'enregistrer les jours.");
  }
  if (set.length > 0) {
    const { error } = await supabase.from("agenda_days").upsert(set, { onConflict: "agenda_id,day" });
    if (error) return serverError(error, "Impossible d'enregistrer les jours.");
  }
  await touchAgenda(supabase, params.id);
  return NextResponse.json({ ok: true });
}

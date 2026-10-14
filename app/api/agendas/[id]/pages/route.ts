import { NextResponse } from "next/server";
import { jsonError, sessionClient, touchAgenda } from "@/lib/agendas/server";
import { AGENDA_PAGE_LABELS, defaultAgendaContent, type AgendaPageKind } from "@/lib/agendas/types";

export const runtime = "nodejs";

const KINDS = Object.keys(AGENDA_PAGE_LABELS) as AgendaPageKind[];

// Ajoute un bloc à la fin de l'agenda, avec son contenu par défaut.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return jsonError("Type de page inconnu.");

  const { data: last } = await supabase
    .from("agenda_pages")
    .select("position")
    .eq("agenda_id", params.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("agenda_pages")
    .insert({ agenda_id: params.id, kind, position, content: defaultAgendaContent(kind) })
    .select("id")
    .single();
  if (error) return jsonError(error.message, 500);
  await touchAgenda(supabase, params.id);
  return NextResponse.json({ id: data.id });
}

// Nouvel ordre des blocs : la liste complète de leurs ids.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const body = (await request.json().catch(() => ({}))) as { order?: unknown };
  const order = Array.isArray(body.order) ? body.order.filter((v): v is string => typeof v === "string") : [];
  if (order.length === 0) return jsonError("Ordre manquant.");

  const results = await Promise.all(
    order.map((pageId, position) =>
      session.supabase.from("agenda_pages").update({ position }).eq("id", pageId).eq("agenda_id", params.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return jsonError(failed.error.message, 500);
  await touchAgenda(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

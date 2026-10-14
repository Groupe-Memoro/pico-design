import { NextResponse } from "next/server";
import { isAgendaPath, jsonError, removeAgendaFiles, sessionClient, touchAgenda } from "@/lib/agendas/server";
import { agendaPageContent, agendaPageFiles, type AgendaPageKind } from "@/lib/agendas/types";

export const runtime = "nodejs";

type Params = { params: { id: string; pageId: string } };

// Remplace le contenu d'un bloc. Les fichiers retirés sont supprimés du stockage.
export async function PATCH(request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const { data: page } = await supabase
    .from("agenda_pages")
    .select("kind, content")
    .eq("id", params.pageId)
    .eq("agenda_id", params.id)
    .maybeSingle();
  if (!page) return jsonError("Page introuvable.", 404);
  const kind = (page as { kind: AgendaPageKind }).kind;

  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = agendaPageContent(kind, body.content);
  const files = agendaPageFiles(kind, content);
  if (files.some((p) => !isAgendaPath(params.id, p))) return jsonError("Fichier invalide.");

  const { error } = await supabase.from("agenda_pages").update({ content }).eq("id", params.pageId);
  if (error) return jsonError(error.message, 500);

  const before = agendaPageFiles(kind, agendaPageContent(kind, (page as { content: unknown }).content));
  await removeAgendaFiles(before.filter((p) => !files.includes(p)));
  await touchAgenda(supabase, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { data } = await session.supabase
    .from("agenda_pages")
    .delete()
    .eq("id", params.pageId)
    .eq("agenda_id", params.id)
    .select("kind, content")
    .maybeSingle();
  if (data) {
    const kind = (data as { kind: AgendaPageKind }).kind;
    await removeAgendaFiles(agendaPageFiles(kind, agendaPageContent(kind, (data as { content: unknown }).content)));
  }
  await touchAgenda(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

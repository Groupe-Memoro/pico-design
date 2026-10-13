import { NextResponse } from "next/server";
import { jsonError, sessionClient, touchAlbum } from "@/lib/albums/server";
import { defaultContent, type AlbumPageKind } from "@/lib/albums/types";

export const runtime = "nodejs";

const KINDS: AlbumPageKind[] = ["cover", "portraits", "free", "signatures"];

// Ajoute un bloc à la fin de l'album, avec son contenu par défaut.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return jsonError("Type de page inconnu.");

  const { data: last } = await supabase
    .from("album_pages")
    .select("position")
    .eq("album_id", params.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("album_pages")
    .insert({ album_id: params.id, kind, position, content: defaultContent(kind) })
    .select("id")
    .single();
  if (error) return jsonError(error.message, 500);
  await touchAlbum(supabase, params.id);
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
      session.supabase.from("album_pages").update({ position }).eq("id", pageId).eq("album_id", params.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return jsonError(failed.error.message, 500);
  await touchAlbum(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

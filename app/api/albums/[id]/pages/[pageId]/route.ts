import { NextResponse } from "next/server";
import { isAlbumPath, jsonError, removeAlbumFiles, sessionClient, touchAlbum } from "@/lib/albums/server";
import { pageContent, type AlbumPageKind, type CoverContent, type FreeContent } from "@/lib/albums/types";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

type Params = { params: { id: string; pageId: string } };

// Photos d'un bloc (couverture, page libre), pour vérifier et nettoyer.
function photosOf(kind: AlbumPageKind, content: unknown): string[] {
  const c = pageContent(kind, content);
  if (kind === "cover") return (c as CoverContent).photo ? [(c as CoverContent).photo!] : [];
  if (kind === "free") return (c as FreeContent).photos;
  return [];
}

// Remplace le contenu d'un bloc. Les photos retirées sont supprimées du stockage.
export async function PATCH(request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const { data: page } = await supabase
    .from("album_pages")
    .select("kind, content")
    .eq("id", params.pageId)
    .eq("album_id", params.id)
    .maybeSingle();
  if (!page) return jsonError("Page introuvable.", 404);
  const kind = (page as { kind: AlbumPageKind }).kind;

  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = pageContent(kind, body.content);
  const photos = photosOf(kind, content);
  if (photos.some((p) => !isAlbumPath(params.id, p))) return jsonError("Photo invalide.");

  const { error } = await supabase.from("album_pages").update({ content }).eq("id", params.pageId);
  if (error) return serverError(error, "Impossible d'enregistrer la page.");

  const before = photosOf(kind, (page as { content: unknown }).content);
  await removeAlbumFiles(before.filter((p) => !photos.includes(p)));
  await touchAlbum(supabase, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { data } = await session.supabase
    .from("album_pages")
    .delete()
    .eq("id", params.pageId)
    .eq("album_id", params.id)
    .select("kind, content")
    .maybeSingle();
  if (data) await removeAlbumFiles(photosOf((data as { kind: AlbumPageKind }).kind, (data as { content: unknown }).content));
  await touchAlbum(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

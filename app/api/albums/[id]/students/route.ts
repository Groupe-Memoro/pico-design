import { NextResponse } from "next/server";
import { isAlbumPath, jsonError, removeAlbumFiles, sessionClient, thumbPathOf, touchAlbum } from "@/lib/albums/server";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/**
 * Ajoute des finissants en lot (import d'une liste, ou un seul à la main), et
 * met une photo à ceux qui en reçoivent une (`photos` : id → chemin).
 * `replace: true` efface d'abord les élèves existants (et leurs photos).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as {
    students?: unknown;
    photos?: unknown;
    replace?: unknown;
  };
  const list = Array.isArray(body.students) ? body.students : [];
  if (list.length > 2000) return jsonError("Trop d'élèves en un envoi (2000 au plus).");

  if (body.replace === true) {
    const { data: old } = await supabase.from("album_students").select("photo_path").eq("album_id", params.id);
    await supabase.from("album_students").delete().eq("album_id", params.id);
    await removeAlbumFiles(((old as { photo_path: string | null }[]) ?? []).map((s) => s.photo_path));
  }

  const rows = list.map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const photo = isAlbumPath(params.id, s.photo_path) ? s.photo_path : null;
    return {
      album_id: params.id,
      first_name: text(s.first_name),
      last_name: text(s.last_name),
      group_name: text(s.group_name),
      photo_path: photo,
      thumb_path: photo ? thumbPathOf(photo) : null,
    };
  }).filter((r) => r.first_name || r.last_name);

  if (rows.length > 0) {
    const { error } = await supabase.from("album_students").insert(rows);
    if (error) return serverError(error, "Impossible d'enregistrer l'élève.");
  }

  // Photos pour des élèves déjà dans l'album (envoi de photos seul).
  const photos = body.photos && typeof body.photos === "object" ? (body.photos as Record<string, unknown>) : {};
  for (const [studentId, path] of Object.entries(photos)) {
    if (!isAlbumPath(params.id, path)) continue;
    const { data: previous } = await supabase.from("album_students").select("photo_path").eq("id", studentId).eq("album_id", params.id).maybeSingle();
    if (!previous) continue;
    await supabase.from("album_students").update({ photo_path: path, thumb_path: thumbPathOf(path) }).eq("id", studentId);
    await removeAlbumFiles([(previous as { photo_path: string | null }).photo_path]);
  }

  await touchAlbum(supabase, params.id);
  return NextResponse.json({ created: rows.length });
}

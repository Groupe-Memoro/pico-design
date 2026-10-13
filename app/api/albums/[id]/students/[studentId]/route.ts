import { NextResponse } from "next/server";
import { isAlbumPath, jsonError, removeAlbumFiles, sessionClient, thumbPathOf, touchAlbum } from "@/lib/albums/server";

export const runtime = "nodejs";

type Params = { params: { id: string; studentId: string } };

// Modifie un finissant : nom, prénom, groupe, photo (null = retirer).
export async function PATCH(request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { data: current } = await supabase
    .from("album_students")
    .select("photo_path")
    .eq("id", params.studentId)
    .eq("album_id", params.id)
    .maybeSingle();
  if (!current) return jsonError("Élève introuvable.", 404);

  const update: Record<string, unknown> = {};
  for (const key of ["first_name", "last_name", "group_name"] as const) {
    if (typeof body[key] === "string") update[key] = (body[key] as string).trim().slice(0, 120);
  }
  let replacedPhoto: string | null = null;
  if (body.photo_path === null || isAlbumPath(params.id, body.photo_path)) {
    const photo = body.photo_path as string | null;
    update.photo_path = photo;
    update.thumb_path = photo ? thumbPathOf(photo) : null;
    replacedPhoto = (current as { photo_path: string | null }).photo_path;
  }

  const { error } = await supabase.from("album_students").update(update).eq("id", params.studentId);
  if (error) return jsonError(error.message, 500);
  if (replacedPhoto && replacedPhoto !== update.photo_path) await removeAlbumFiles([replacedPhoto]);
  await touchAlbum(supabase, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);
  const { data } = await session.supabase
    .from("album_students")
    .delete()
    .eq("id", params.studentId)
    .eq("album_id", params.id)
    .select("photo_path")
    .maybeSingle();
  await removeAlbumFiles([(data as { photo_path: string | null } | null)?.photo_path]);
  await touchAlbum(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

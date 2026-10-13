import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { albumStorage, jsonError, sessionClient, thumbPathOf } from "@/lib/albums/server";

export const runtime = "nodejs";

/**
 * Adresses d'envoi à usage unique pour déposer des photos d'album DIRECTEMENT
 * dans le stockage depuis le navigateur (Vercel refuse les requêtes de plus de
 * 4,5 Mo). Pour chaque photo : sa version d'impression et sa vignette, que le
 * navigateur a déjà réduites (voir lib/albums/upload.ts).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const body = (await request.json().catch(() => ({}))) as { count?: unknown };
  const count = Math.floor(Number(body.count));
  if (!Number.isFinite(count) || count < 1 || count > 100) return jsonError("Nombre de photos invalide (1 à 100 par envoi).");

  const { data: album } = await session.supabase.from("albums").select("id").eq("id", params.id).maybeSingle();
  if (!album) return jsonError("Album introuvable.", 404);

  const storage = albumStorage();
  const uploads = [];
  for (let i = 0; i < count; i++) {
    const photoPath = `${params.id}/photos/${randomUUID()}.jpg`;
    const thumbPath = thumbPathOf(photoPath);
    const [photo, thumb] = await Promise.all([storage.createSignedUploadUrl(photoPath), storage.createSignedUploadUrl(thumbPath)]);
    if (photo.error || thumb.error || !photo.data || !thumb.data) {
      return jsonError(photo.error?.message ?? thumb.error?.message ?? "Préparation de l'envoi impossible.", 500);
    }
    uploads.push({ photoPath, photoToken: photo.data.token, thumbPath, thumbToken: thumb.data.token });
  }
  return NextResponse.json({ uploads });
}

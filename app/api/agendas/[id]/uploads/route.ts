import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { agendaStorage, jsonError, sessionClient, thumbPathOf } from "@/lib/agendas/server";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Adresses d'envoi à usage unique, pour déposer DIRECTEMENT dans le stockage
 * (Vercel refuse les requêtes de plus de 4,5 Mo) :
 *   * des photos (couverture, page d'info, commanditaires, bandeaux) : pour
 *     chacune, sa version d'impression et sa vignette (voir lib/print/upload.ts) ;
 *   * un PDF fourni par l'école (`kind: "pdf"`), envoyé tel quel.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const body = (await request.json().catch(() => ({}))) as { count?: unknown; kind?: unknown };
  const { data: agenda } = await session.supabase.from("agendas").select("id").eq("id", params.id).maybeSingle();
  if (!agenda) return jsonError("Agenda introuvable.", 404);
  const storage = agendaStorage();

  if (body.kind === "pdf") {
    const path = `${params.id}/pdfs/${randomUUID()}.pdf`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return serverError(error, "Préparation de l'envoi impossible.");
    return NextResponse.json({ pdf: { path, token: data.token } });
  }

  const count = Math.floor(Number(body.count));
  if (!Number.isFinite(count) || count < 1 || count > 100) return jsonError("Nombre de photos invalide (1 à 100 par envoi).");
  const uploads = [];
  for (let i = 0; i < count; i++) {
    const photoPath = `${params.id}/photos/${randomUUID()}.jpg`;
    const thumbPath = thumbPathOf(photoPath);
    const [photo, thumb] = await Promise.all([storage.createSignedUploadUrl(photoPath), storage.createSignedUploadUrl(thumbPath)]);
    if (photo.error || thumb.error || !photo.data || !thumb.data) {
      return serverError(photo.error ?? thumb.error, "Préparation de l'envoi impossible.");
    }
    uploads.push({ photoPath, photoToken: photo.data.token, thumbPath, thumbToken: thumb.data.token });
  }
  return NextResponse.json({ uploads });
}

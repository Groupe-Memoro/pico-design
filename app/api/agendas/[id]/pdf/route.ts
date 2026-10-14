import { NextResponse } from "next/server";
import { agendaStorage, geometryOf, jsonError, loadAgenda, sessionClient } from "@/lib/agendas/server";
import { layoutAgenda } from "@/lib/agendas/layout";
import { renderPrintPdf } from "@/lib/print/render";
import { pdfDownloadName } from "@/lib/imposition/saved";

export const runtime = "nodejs";
// Une année de semaines : quelques centaines de pages.
export const maxDuration = 300;

/**
 * Génère le PDF d'impression de l'agenda, le range avec lui (<id>/agenda.pdf)
 * et renvoie une adresse de téléchargement (trop lourd pour la réponse).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const loaded = await loadAgenda(session.supabase, params.id);
  if (!loaded) return jsonError("Agenda introuvable.", 404);
  const { agenda, days, pages } = loaded;

  const geometry = geometryOf(agenda);
  const laidOut = layoutAgenda(geometry, agenda, agenda.settings, pages, days);
  if (laidOut.length === 0) return jsonError("L'agenda n'a aucune page.");

  const storage = agendaStorage();
  let pdf: Uint8Array;
  try {
    pdf = await renderPrintPdf(
      geometry,
      laidOut,
      async (path) => {
        const { data } = await storage.download(path);
        return data ? Buffer.from(await data.arrayBuffer()) : null;
      },
      agenda.name
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Erreur lors de la génération du PDF.", 500);
  }

  const path = `${params.id}/agenda.pdf`;
  const { error } = await storage.upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) return jsonError(`Enregistrement du PDF impossible : ${error.message}`, 500);
  await session.supabase.from("agendas").update({ pdf_path: path, pdf_generated_at: new Date().toISOString() }).eq("id", params.id);

  const { data: signed } = await storage.createSignedUrl(path, 60 * 30, { download: pdfDownloadName(agenda.name) });
  return NextResponse.json({ url: signed?.signedUrl ?? null, pages: laidOut.length });
}

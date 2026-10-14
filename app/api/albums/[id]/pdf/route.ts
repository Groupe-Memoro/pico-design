import { NextResponse } from "next/server";
import { albumStorage, jsonError, loadAlbum, sessionClient } from "@/lib/albums/server";
import { layoutAlbum } from "@/lib/albums/layout";
import { renderPrintPdf } from "@/lib/print/render";
import { pdfDownloadName } from "@/lib/imposition/saved";

export const runtime = "nodejs";
// Un album de plusieurs centaines de photos : lecture, recadrage, assemblage.
export const maxDuration = 300;

/**
 * Génère le PDF d'impression de l'album, le range avec lui (<id>/album.pdf)
 * et renvoie une adresse de téléchargement. Le fichier est trop lourd pour
 * passer dans la réponse (Vercel plafonne à 4,5 Mo).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await sessionClient();
  if (!session) return jsonError("Non authentifié.", 401);

  const loaded = await loadAlbum(session.supabase, params.id);
  if (!loaded) return jsonError("Album introuvable.", 404);
  const { album, students, pages } = loaded;

  const geometry = { widthMm: Number(album.width_mm), heightMm: Number(album.height_mm), bleedMm: Number(album.bleed_mm) };
  const laidOut = layoutAlbum(geometry, album.settings, pages, students);
  if (laidOut.length === 0) return jsonError("L'album n'a aucune page.");

  const storage = albumStorage();
  let pdf: Uint8Array;
  try {
    pdf = await renderPrintPdf(
      geometry,
      laidOut,
      async (path) => {
        const { data } = await storage.download(path);
        return data ? Buffer.from(await data.arrayBuffer()) : null;
      },
      album.name
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Erreur lors de la génération du PDF.", 500);
  }

  const path = `${params.id}/album.pdf`;
  const { error } = await storage.upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) return jsonError(`Enregistrement du PDF impossible : ${error.message}`, 500);
  await session.supabase
    .from("albums")
    .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() })
    .eq("id", params.id);

  const { data: signed } = await storage.createSignedUrl(path, 60 * 30, { download: pdfDownloadName(album.name) });
  return NextResponse.json({ url: signed?.signedUrl ?? null, pages: laidOut.length });
}

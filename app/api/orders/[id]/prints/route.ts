import { NextResponse } from "next/server";
import { PDFDocument, PDFName } from "pdf-lib";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { formDataFromSubmission, type DesignSubmission } from "@/lib/design/submission";
import { renderPdfFromForm } from "@/lib/design/renderPdf";
import { mapLimit } from "@/lib/concurrency";
import { pdfDownloadName } from "@/lib/imposition/saved";

export const runtime = "nodejs";
// Une commande de photos peut compter des dizaines de designs à rendre.
export const maxDuration = 300;

const BUCKET = "outputs";

/**
 * PDF des tirages d'une commande : chaque ligne (design du client, ou
 * produit déjà fait) répétée autant de fois que sa quantité — une page par
 * tirage (deux pour un recto-verso), prêt pour l'Imposition (mode Document).
 * Chaque design n'est rendu qu'une fois, puis ses pages sont recopiées.
 *
 * Trop lourd pour passer dans la réponse (Vercel plafonne à 4,5 Mo) : rangé
 * dans le stockage, et une adresse de téléchargement est renvoyée.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, order_items(design_submission_id, product_id, quantity, title)")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  const items = ((order as { order_items: { design_submission_id: string | null; product_id: string | null; quantity: number; title: string | null }[] }).order_items ?? []).filter(
    (i) => i.design_submission_id || i.product_id
  );
  if (items.length === 0) return NextResponse.json({ error: "Aucune ligne à imprimer dans cette commande." }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const out = await PDFDocument.create();
  try {
    // Tous les designs en une requête, au lieu d'une par ligne.
    const submissionIds = Array.from(new Set(items.flatMap((i) => (i.design_submission_id ? [i.design_submission_id] : []))));
    const { data: submissionRows } = submissionIds.length
      ? await admin.from("design_submissions").select("*").in("id", submissionIds)
      : { data: [] };
    const submissionById = new Map(((submissionRows as DesignSubmission[] | null) ?? []).map((s) => [s.id, s]));

    const loadItemPdf = async (item: (typeof items)[number]): Promise<Uint8Array> => {
      if (item.design_submission_id) {
        const submission = submissionById.get(item.design_submission_id);
        if (!submission) throw new Error(`Design introuvable pour « ${item.title ?? "une ligne"} ».`);
        const { pdf } = await renderPdfFromForm(admin, await formDataFromSubmission(admin, submission), submission.template_id);
        return pdf;
      }
      const { data: product } = await admin.from("products").select("pdf_path").eq("id", item.product_id!).maybeSingle();
      const path = (product as { pdf_path: string | null } | null)?.pdf_path;
      const file = path ? (await admin.storage.from(BUCKET).download(path)).data : null;
      if (!file) throw new Error(`PDF du produit introuvable pour « ${item.title ?? "une ligne"} ».`);
      return new Uint8Array(await file.arrayBuffer());
    };

    // Rendus 3 par 3 (mémoire : sharp sur des images 300 dpi), assemblés lot
    // par lot dans l'ordre des lignes : au plus 3 PDF sources en mémoire à la fois.
    const BATCH = 3;
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH);
      const batchBytes = await mapLimit(batch, BATCH, loadItemPdf);
      for (const [n, bytes] of batchBytes.entries()) {
        const item = batch[n];
        const source = await PDFDocument.load(bytes);
        // Les pages ne sont embarquées qu'une fois ; chaque tirage les redessine
        // (sans dupliquer le flux de l'image) sur une page aux mêmes boîtes.
        const sourcePages = source.getPages();
        const embedded = await out.embedPages(sourcePages);
        for (let copy = 0; copy < Math.max(1, item.quantity); copy++) {
          sourcePages.forEach((src, i) => {
            const media = src.getMediaBox();
            const page = out.addPage([media.width, media.height]);
            // Mêmes boîtes que la page source (origine comprise) ; TrimBox/BleedBox
            // seulement si la source les déclare, comme avec copyPages.
            page.setMediaBox(media.x, media.y, media.width, media.height);
            page.drawPage(embedded[i], { x: media.x, y: media.y, width: media.width, height: media.height });
            if (src.node.has(PDFName.of("TrimBox"))) {
              const t = src.getTrimBox();
              page.setTrimBox(t.x, t.y, t.width, t.height);
            }
            if (src.node.has(PDFName.of("BleedBox"))) {
              const bl = src.getBleedBox();
              page.setBleedBox(bl.x, bl.y, bl.width, bl.height);
            }
          });
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors de la génération du PDF." }, { status: 500 });
  }

  const number = ((order as { order_number: string | null }).order_number ?? "").replace(/^#/, "").trim();
  const path = `orders/${params.id}/tirages.pdf`;
  const { error } = await admin.storage.from(BUCKET).upload(path, await out.save(), { contentType: "application/pdf", upsert: true });
  if (error) return NextResponse.json({ error: `Enregistrement du PDF impossible : ${error.message}` }, { status: 500 });
  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 30, { download: pdfDownloadName(`${number || "commande"}-tirages`) });
  return NextResponse.json({ url: signed?.signedUrl ?? null, pages: out.getPageCount() });
}

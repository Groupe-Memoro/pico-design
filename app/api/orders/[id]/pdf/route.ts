import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { formDataFromSubmission, type DesignSubmission } from "@/lib/design/submission";
import { renderPdfFromForm } from "@/lib/design/renderPdf";
import { pdfDownloadName } from "@/lib/imposition/saved";
import { contentDisposition } from "@/lib/contentDisposition";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fabrique le PDF d'impression d'un design enregistré, à la demande depuis le
 * module Commande. Rien n'est stocké : la plupart des designs enregistrés ne
 * sont jamais payés, et un correctif de rendu profite ainsi aux commandes
 * déjà passées.
 *
 * Le FormData d'origine est reconstitué puis passé au MÊME chemin de rendu
 * que le téléchargement direct (renderPdfFromForm) : le fichier obtenu ici
 * est celui que le client a vu à l'écran.
 *
 * Nommé « <n° de commande>-<id du design>.pdf » (ex. PICO1454-b293e0b1-….pdf)
 * quand le design appartient à une commande : le fichier se retrouve à
 * partir de la commande, et inversement.
 *
 * Réservé aux utilisateurs connectés — c'est un écran interne.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data } = await supabase.from("design_submissions").select("*").eq("id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Design introuvable." }, { status: 404 });
  const submission = data as DesignSubmission;

  // Client admin pour relire les fichiers du bucket, comme le parcours
  // public : les fichiers d'un client anonyme n'appartiennent à personne.
  const admin = createAdminSupabaseClient();
  try {
    const formData = await formDataFromSubmission(admin, submission);
    const [{ pdf, filename: defaultName }, orderNumber] = await Promise.all([
      renderPdfFromForm(admin, formData, submission.template_id),
      orderNumberOf(admin, submission.id),
    ]);
    const filename = orderNumber ? pdfDownloadName(`${orderNumber}-${submission.id}`) : defaultName;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors de la génération du PDF." },
      { status: 500 }
    );
  }
}

// Numéro de la commande qui contient ce design (sans le « # » de Shopify),
// ou null s'il n'a pas (encore) été commandé.
async function orderNumberOf(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  designId: string
): Promise<string | null> {
  const { data } = await admin
    .from("order_items")
    .select("orders(order_number)")
    .eq("design_submission_id", designId)
    .limit(1)
    .maybeSingle();
  const order = (data as { orders: { order_number: string | null } | null } | null)?.orders;
  const number = order?.order_number?.replace(/^#/, "").trim();
  return number || null;
}

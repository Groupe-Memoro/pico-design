import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { publicUploadError } from "@/lib/uploadLimits";
import { renderPdfFromForm } from "@/lib/design/renderPdf";
import { contentDisposition } from "@/lib/contentDisposition";

export const runtime = "nodejs"; // sharp/pdf-lib ont besoin du runtime Node, pas Edge.
export const maxDuration = 60;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Design Shopify (étape Résumé) : le PDF prêt-pour-impression final — pas un
 * aperçu (voir /api/products/preview, capé à 900 px) : pleine résolution,
 * fond perdu compris, recto + verso dans un seul fichier, exactement comme
 * pour un vrai Produit (lib/pdf/productPdf.ts). Contrairement au vrai
 * Produit, jamais de logo Pico ici, même si le modèle a
 * `logo_on_front`/`logo_on_back`.
 *
 * Le rendu lui-même vit dans lib/design/renderPdf.ts : le module Commande le
 * rejoue à l'identique depuis un design enregistré, et deux implémentations
 * finiraient par diverger.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let formData = await request.formData();
  const templateId = formData.get("templateId");
  if (typeof templateId !== "string")
    return errorResponse("Paramètre manquant (templateId).");
  // Voir /api/design/mockup : lien public accepté, mais seulement pour le
  // modèle que le laissez-passer désigne.
  if (!user && !grantAllows(formData.get("grant"), templateId)) {
    return errorResponse("Non authentifié.", 401);
  }
  // Fichiers déposés directement dans le stockage par l'outil (au-delà de
  // la limite de 4,5 Mo des requêtes Vercel) : remis en place avant tout le
  // reste, contrôles de taille compris.
  try {
    formData = await hydrateStagedFiles(formData);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fichier introuvable." },
      { status: 400 },
    );
  }
  // Appel public : compter et plafonner (voir lib/rateLimit.ts). Les
  // utilisateurs connectés ne sont pas limités.
  if (!user) {
    const limit = await checkRateLimit("pdf", request);
    if (!limit.allowed) return tooManyRequests("pdf");
    // Le débit plafonne les APPELS, pas les octets (voir lib/uploadLimits.ts).
    const tropLourd = publicUploadError(formData);
    if (tropLourd) return errorResponse(tropLourd, 413);
  }
  const db = user ? supabase : createAdminSupabaseClient();

  try {
    const { pdf, filename } = await renderPdfFromForm(db, formData, templateId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error
        ? err.message
        : "Erreur lors de la génération du PDF.",
    );
  }
}

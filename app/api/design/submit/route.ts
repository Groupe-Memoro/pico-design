import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { randomUUID } from "crypto";
import sharp from "sharp";
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { splitFormData } from "@/lib/design/submission";
import { publicUploadError } from "@/lib/uploadLimits";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Enregistre le design d'un client avant qu'il retourne payer sur Shopify
 * (module Commande, voir supabase/migrations/0055_orders.sql).
 *
 * Reçoit exactement le FormData que l'outil compose déjà pour le PDF : les
 * champs partent en base, les fichiers dans le bucket. Le PDF, lui, n'est PAS
 * fabriqué ici — il le sera à la demande depuis le module, et la plupart des
 * designs enregistrés ne seront jamais payés (paniers abandonnés).
 *
 * Même garde que le reste du parcours public : un laissez-passer valable pour
 * ce modèle précis (voir lib/publicDesign.ts).
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
  // Impression de photos : les photos d'un même envoi partagent un lot (voir
  // app/api/design/batch), avec son propre plafond — une commande en compte
  // des dizaines.
  const batchRaw = formData.get("batchId");
  const batchId = typeof batchRaw === "string" && /^[0-9a-f-]{36}$/i.test(batchRaw) ? batchRaw : null;
  if (!user) {
    const bucket = batchId ? "photos" : "submit";
    const limit = await checkRateLimit(bucket, request);
    if (!limit.allowed) return tooManyRequests(bucket);
    // Le débit plafonne les APPELS, pas les octets : sans ça, vingt envois
    // par heure suffisent à écrire plusieurs gigaoctets (voir
    // lib/uploadLimits.ts).
    const tropLourd = publicUploadError(formData);
    if (tropLourd) return errorResponse(tropLourd, 413);
  }

  // Écriture par la clé de service : le client public n'a pas de session, et
  // la RLS de design_submissions n'ouvre rien à l'anonyme.
  const admin = createAdminSupabaseClient();
  const id = randomUUID();
  // Aperçu du design (le mockup vu dans « Vérifier et commander »), affiché
  // ensuite dans le panier Shopify. Retiré avant splitFormData : ce n'est pas
  // un ingrédient du rendu, le rejouer ne servirait à rien.
  const preview = formData.get("preview");
  formData.delete("preview");
  const { fields, files } = splitFormData(formData);

  const sourcePaths: {
    field: string;
    path: string;
    name: string;
    type: string;
  }[] = [];
  for (const [index, entry] of files.entries()) {
    const extension = entry.file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `submissions/${id}/${index}-${entry.field}.${extension}`;
    const { error } = await admin.storage
      .from("uploads")
      .upload(path, Buffer.from(await entry.file.arrayBuffer()), {
        contentType: entry.file.type || "application/octet-stream",
        upsert: true,
      });
    if (error)
      return errorResponse(
        `Impossible d'enregistrer le fichier : ${error.message}`,
        500,
      );
    sourcePaths.push({
      field: entry.field,
      path,
      name: entry.file.name,
      type: entry.file.type,
    });
  }

  const mockupPath = preview instanceof File && preview.size > 0 ? await storePreview(admin, id, preview) : null;

  const quantityRaw = Number(formData.get("quantity"));
  const variantId = formData.get("variantId");

  const { data, error } = await admin
    .from("design_submissions")
    .insert({
      id,
      template_id: templateId,
      rotated: formData.get("rotated") === "true",
      payload: fields,
      source_paths: sourcePaths,
      mockup_path: mockupPath,
      batch_id: batchId,
      shopify_variant_id:
        typeof variantId === "string" && variantId ? variantId : null,
      quantity:
        Number.isFinite(quantityRaw) && quantityRaw > 0
          ? Math.floor(quantityRaw)
          : 1,
    })
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);
  return NextResponse.json({ id: (data as { id: string }).id });
}

// Aperçu ré-encodé (WebP, 800 px de large au plus) : léger pour le panier, et
// une image fabriquée ici, jamais le fichier du client tel quel. Facultatif :
// un aperçu illisible ou absent n'empêche pas d'enregistrer le design.
async function storePreview(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  id: string,
  file: File,
): Promise<string | null> {
  try {
    const webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const path = `submissions/${id}/preview.webp`;
    const { error } = await admin.storage
      .from("uploads")
      .upload(path, webp, { contentType: "image/webp", upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

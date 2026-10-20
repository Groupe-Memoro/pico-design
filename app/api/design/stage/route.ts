import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/lib/uploadLimits";
import { STAGING_BUCKET, TEAM_STAGING_BUCKET } from "@/lib/design/staging";

export const runtime = "nodejs";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Adresses d'envoi à usage unique pour déposer les fichiers de l'outil de
 * design DIRECTEMENT dans le stockage (voir lib/design/stageUpload.ts et
 * supabase/migrations/0069_design_staging.sql) : Vercel refuse toute requête
 * de plus de 4,5 Mo avant même d'atteindre les routes de rendu.
 *
 * Même garde que ces routes : une session, ou un laissez-passer valable pour
 * ce modèle. Pour le public, mêmes plafonds de taille et de type que
 * lib/uploadLimits.ts, vérifiés ici sur ce que le navigateur annonce, puis
 * imposés par le bucket (taille, types) et revérifiés sur les vrais fichiers
 * par les routes de rendu.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const body = (await request.json().catch(() => ({}))) as {
    templateId?: unknown;
    grant?: unknown;
    files?: unknown;
  };
  const templateId = typeof body.templateId === "string" ? body.templateId : null;
  if (!templateId) return errorResponse("Paramètre manquant (templateId).");
  if (!user && !grantAllows(body.grant, templateId)) return errorResponse("Non authentifié.", 401);

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0 || files.length > 40) return errorResponse("Liste de fichiers invalide.");

  if (!user) {
    const limit = await checkRateLimit("stage", request);
    if (!limit.allowed) return tooManyRequests("stage");
    let total = 0;
    for (const file of files) {
      const size = Number((file as { size?: unknown })?.size);
      const type = String((file as { type?: unknown })?.type ?? "");
      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
        return errorResponse(`Fichier trop lourd. Maximum ${Math.round(MAX_FILE_BYTES / 1048576)} Mo par fichier.`, 413);
      }
      if (type && !type.startsWith("image/") && type !== "application/pdf") {
        return errorResponse(`Format non accepté (${type}). Images et PDF seulement.`);
      }
      total += size;
    }
    if (total > MAX_TOTAL_BYTES) {
      return errorResponse(`Envoi trop lourd. Maximum ${Math.round(MAX_TOTAL_BYTES / 1048576)} Mo en tout.`, 413);
    }
  }

  const day = new Date().toISOString().slice(0, 10);
  // L'équipe dépose ses fichiers d'impression (souvent bien plus de 40 Mo)
  // dans son propre bucket ; l'outil public garde sa limite.
  const bucket = user ? TEAM_STAGING_BUCKET : STAGING_BUCKET;
  const storage = createAdminSupabaseClient().storage.from(bucket);
  const uploads = [];
  for (let i = 0; i < files.length; i++) {
    const path = `${day}/${randomUUID()}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return errorResponse(error?.message ?? "Préparation de l'envoi impossible.", 500);
    uploads.push({ path, token: data.token, bucket });
  }
  return NextResponse.json({ uploads });
}

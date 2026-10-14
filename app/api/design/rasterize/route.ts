import sharp from "sharp";
import { NextResponse } from "next/server";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { grantAllows } from "@/lib/publicDesign";
import { hydrateStagedFiles } from "@/lib/design/stagedFiles";
import { publicUploadError } from "@/lib/uploadLimits";
import { isPdfBuffer, rasterizePdfPage } from "@/lib/pdf/rasterizePdf";

export const runtime = "nodejs";
export const maxDuration = 30;

const PREVIEW_MAX_PX = 1200;

/**
 * Aperçu d'un PDF déposé dans un volet (composition par volet d'un produit
 * plié) : sa première page en JPEG, pour l'écran seulement — le navigateur ne
 * sait pas afficher un PDF dans une case. L'impression, elle, repart du PDF
 * d'origine (voir composeMosaicImage).
 *
 * Même garde que les routes de rendu : une session, ou un laissez-passer
 * valable pour ce modèle (mode public, avec plafond de débit).
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let formData: FormData;
  try {
    formData = await hydrateStagedFiles(await request.formData());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fichier introuvable." }, { status: 400 });
  }
  const templateId = formData.get("templateId");
  if (!user) {
    if (typeof templateId !== "string" || !grantAllows(formData.get("grant"), templateId)) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }
    const limit = await checkRateLimit("preview", request);
    if (!limit.allowed) return tooManyRequests("preview");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Aucun fichier." }, { status: 400 });
  if (!user) {
    const tooBig = publicUploadError(formData);
    if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(bytes)) return NextResponse.json({ error: "Ce fichier n'est pas un PDF." }, { status: 400 });

  try {
    const png = await rasterizePdfPage(bytes, 1);
    const jpeg = await sharp(png)
      .resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Impossible de lire ce PDF." }, { status: 422 });
  }
}

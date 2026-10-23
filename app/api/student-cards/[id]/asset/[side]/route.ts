import { NextResponse } from "next/server";
import sharp from "sharp";
import { pdfToPng } from "pdf-to-png-converter";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { SIDE_COLUMN, STUDENT_CARDS_BUCKET } from "@/lib/studentCards/assets";
import { detectMarksKind } from "@/lib/imposition/marks";

export const runtime = "nodejs";
export const maxDuration = 30;

// Assez pour placer les zones au dixième de millimètre sur une carte.
const PREVIEW_WIDTH_PX = 1400;

const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Le fond d'une face, en PNG pour l'éditeur (une balise <image> SVG ne lit pas un PDF).
export async function GET(_request: Request, { params }: { params: { id: string; side: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error("Non authentifié.", 401);
  if (params.side !== "front" && params.side !== "back") return error("Face inconnue.", 404);

  const column = SIDE_COLUMN[params.side];
  const { data: row } = await supabase
    .from("student_card_templates")
    .select(column)
    .eq("id", params.id)
    .single<Record<string, string | null>>();
  const path = row?.[column];
  if (!path) return error("Aucun fond pour cette face.", 404);

  const { data: file } = await createAdminSupabaseClient().storage.from(STUDENT_CARDS_BUCKET).download(path);
  if (!file) return error("Fichier introuvable.", 404);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    let image: Buffer = bytes;
    if (detectMarksKind(bytes) === "pdf") {
      const [page] = await pdfToPng(bytes, { pagesToProcess: [1], viewportScale: 6 });
      if (!page?.content) throw new Error();
      image = page.content;
    }
    const png = await sharp(image).resize({ width: PREVIEW_WIDTH_PX, withoutEnlargement: true }).png().toBuffer();
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch {
    return error("Impossible de lire ce fichier.", 422);
  }
}

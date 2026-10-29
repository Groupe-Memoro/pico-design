import { requireApiUser } from "@/lib/api";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 30;

// Largeur des vignettes de la banque de visuels (grilles et sélecteurs).
const THUMBNAIL_WIDTH_PX = 400;

// Vignette stable et cachable d'un visuel : contrairement à l'adresse signée du
// fichier (régénérée à chaque chargement de page), cette adresse ne change pas,
// donc le navigateur la garde. `?v=` porte le chemin du fichier : il change
// quand le visuel est remplacé par un fichier de nom différent.
// Réservé aux employés connectés (comme la table `visuals`) ; l'outil public
// Shopify ne reçoit aucun visuel.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const { data: visual } = await supabase.from("visuals").select("file_path, mime_type").eq("id", params.id).maybeSingle();
  if (!visual) return NextResponse.json({ error: "Introuvable." }, { status: 404 });

  const { data: blob, error } = await supabase.storage.from("visuals").download(visual.file_path);
  if (error || !blob) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });

  try {
    // Un SVG est rastérisé à 72 dpi par défaut : un petit viewBox donnerait une
    // vignette floue (withoutEnlargement interdit de l'agrandir ensuite).
    const isSvg = visual.mime_type === "image/svg+xml" || visual.file_path.endsWith(".svg");
    const out = await sharp(Buffer.from(await blob.arrayBuffer()), isSvg ? { density: 300 } : undefined)
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
      // WebP conserve la transparence des PNG/SVG et allège les photos.
      .webp({ quality: 80 })
      .toBuffer();
    const versioned = new URL(request.url).searchParams.has("v");
    return new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/webp",
        // Immuable seulement si l'adresse porte une version ; sinon durée courte.
        "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Vignette impossible." }, { status: 422 });
  }
}

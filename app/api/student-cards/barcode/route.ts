import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { barcodeGeometry } from "@/lib/studentCards/barcode";
import { isBarcodeType } from "@/lib/studentCards/types";

export const runtime = "nodejs";

/**
 * Aperçu d'un code-barres pour l'éditeur : le même dessin que dans le PDF
 * (voir barcodeGeometry), en SVG. `w` et `h` : la zone en mm, contenu non tourné.
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const q = new URL(request.url).searchParams;
  const type = q.get("type");
  const text = (q.get("text") ?? "").slice(0, 300);
  const w = Number(q.get("w"));
  const h = Number(q.get("h"));
  if (!isBarcodeType(type) || !text || !(w > 0) || !(h > 0)) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }
  try {
    const g = barcodeGeometry(type, text, w, h, q.get("showText") !== "0");
    return new NextResponse(g.svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Code impossible." }, { status: 422 });
  }
}

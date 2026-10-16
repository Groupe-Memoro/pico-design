import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { contentDisposition } from "@/lib/contentDisposition";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: product, error } = await supabase
    .from("products")
    .select("name, pdf_path")
    .eq("id", params.id)
    .single<{ name: string; pdf_path: string | null }>();
  if (error || !product) {
    return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  }
  if (!product.pdf_path) {
    return NextResponse.json(
      { error: "Le PDF n'a pas encore été généré pour ce produit." },
      { status: 404 }
    );
  }

  // Le stockage peut refuser un téléchargement de façon passagère (vu juste
  // après la création d'un produit : échec, puis succès moins d'une minute
  // plus tard). On réessaie avant d'abandonner, et la vraie raison part dans
  // les journaux — le message « introuvable » laissait croire à un fichier perdu.
  const admin = createAdminSupabaseClient();
  let file: Blob | null = null;
  let lastError: unknown = null;
  for (const delayMs of [0, 500, 1000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const { data, error: downloadError } = await admin.storage.from("outputs").download(product.pdf_path);
    if (data) {
      file = data;
      break;
    }
    lastError = downloadError;
  }
  if (!file) {
    console.error(`PDF du produit ${params.id} (${product.pdf_path}) : téléchargement impossible`, lastError);
    return NextResponse.json(
      { error: "Le PDF n'est pas disponible pour l'instant. Réessayez dans un instant." },
      { status: 503 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = product.name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim() || "produit";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(`${safeName}.pdf`),
      "Cache-Control": "private, no-store",
    },
  });
}

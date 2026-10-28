import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";

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

  // Trop lourd pour passer dans la réponse (Vercel plafonne à 4,5 Mo) : on
  // redirige vers une adresse signée du stockage, qui force le téléchargement.
  // Le stockage peut refuser de façon passagère (vu juste après la création
  // d'un produit) : on réessaie avant d'abandonner, et la vraie raison part
  // dans les journaux.
  const safeName = product.name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim() || "produit";
  const admin = createAdminSupabaseClient();
  let signedUrl: string | null = null;
  let lastError: unknown = null;
  for (const delayMs of [0, 500, 1000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const { data, error: signError } = await admin.storage
      .from("outputs")
      .createSignedUrl(product.pdf_path, 60 * 10, { download: `${safeName}.pdf` });
    if (data?.signedUrl) {
      signedUrl = data.signedUrl;
      break;
    }
    lastError = signError;
  }
  if (!signedUrl) {
    console.error(`PDF du produit ${params.id} (${product.pdf_path}) : adresse de téléchargement impossible`, lastError);
    return NextResponse.json(
      { error: "Le PDF n'est pas disponible pour l'instant. Réessayez dans un instant." },
      { status: 503 }
    );
  }

  return NextResponse.redirect(signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { readDocumentInfo } from "@/lib/imposition/documentInfo";

export const runtime = "nodejs";
export const maxDuration = 30;

const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Pages, format et fond perdu du PDF d'un produit Pico, pour l'imposer comme
// document de plusieurs pages (voir lib/imposition/documentInfo.ts).
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error("Non authentifié.", 401);

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return error("Produit manquant.");
  const { data: product } = await supabase
    .from("products")
    .select("pdf_path")
    .eq("id", productId)
    .single<{ pdf_path: string | null }>();
  if (!product?.pdf_path) return error("PDF du produit introuvable.", 404);
  const { data, error: downloadError } = await createAdminSupabaseClient().storage.from("outputs").download(product.pdf_path);
  if (downloadError || !data) return error("PDF du produit introuvable.", 404);

  try {
    return NextResponse.json(await readDocumentInfo(await data.arrayBuffer()));
  } catch (err) {
    return error(err instanceof Error ? err.message : "Impossible de lire ce PDF.", 422);
  }
}

import sharp from "sharp";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";
import { renderProductMockup } from "@/lib/products/mockup";
import { listTemplateMockups } from "@/lib/templateMockups";
import { signedUrls } from "@/lib/storageUrls";
import type { Product, Template } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Shopify télécharge les images à l'import : les adresses doivent tenir le
// temps qu'on importe le fichier.
const URL_LIFETIME_S = 60 * 60 * 24 * 7;

/**
 * Images d'un produit pour l'export Shopify : chacun des mockups de son
 * modèle (ou, sans mockup, son aperçu à plat ou plié), en PNG dans
 * `outputs/shopify-export/<produit>/`, avec des adresses signées 7 jours.
 * Appelée produit par produit par la page Produits, pour suivre la
 * progression et ne pas dépasser la durée maximale d'une requête.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: product } = await supabase.from("products").select("*").eq("id", params.id).single<Product>();
  if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  const { data: template } = await supabase
    .from("templates")
    .select("*")
    .eq("id", product.template_id)
    .single<Template>();
  if (!template) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });

  const admin = createAdminSupabaseClient();
  const mockups = await listTemplateMockups(supabase, template.id);
  // null = le bundle hérité, le masque/ombrage, ou l'aperçu du produit.
  const mockupIds: (string | null)[] = mockups.length ? mockups.map((m) => m.id) : [null];

  try {
    const paths: string[] = [];
    for (const [i, mockupId] of mockupIds.entries()) {
      const png = await renderProductMockup(supabase, admin, product, template, { mockupId, flatFallback: true });
      // PNG (fond transparent conservé) en palette : 3 à 4 fois plus léger
      // qu'un PNG 24 bits, sans différence visible sur un mockup (~0,5 Mo
      // en 2048 px, assez pour le zoom de Shopify).
      const image = await sharp(png)
        .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
        .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
        .toBuffer();
      const path = `shopify-export/${product.id}/${i + 1}.png`;
      const { error } = await admin.storage.from("outputs").upload(path, image, { contentType: "image/png", upsert: true });
      if (error) throw new Error(error.message);
      paths.push(path);
    }
    const urls = await signedUrls(admin, "outputs", paths, URL_LIFETIME_S);
    return NextResponse.json({ images: paths.flatMap((p) => (urls.has(p) ? [urls.get(p)!] : [])) });
  } catch (err) {
    return NextResponse.json(
      { error: `${product.name} : ${err instanceof Error ? err.message : "mockup impossible"}` },
      { status: 500 }
    );
  }
}

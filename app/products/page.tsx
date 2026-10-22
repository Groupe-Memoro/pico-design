import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import ProductsTable, { type ProductWithTemplate } from "@/components/ProductsTable";
import type { VisualWithUrl } from "@/components/VisualsGrid";
import type { Category, ProductCollection, Template, Visual } from "@/lib/types";
import { signedUrls } from "@/lib/storageUrls";
import { selectAll } from "@/lib/supabase/selectAll";

export default async function ProductsPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [
    { data: products },
    { data: templates },
    { data: categories },
    { data: visuals },
    { data: productCollections },
    { data: mockupRows },
  ] = await Promise.all([
    // Tous les produits, au-delà des 1000 lignes d'une requête.
    selectAll((from, to) =>
      supabase
        .from("products")
        .select(
          "*, template:templates(name, category_id, width_mm, height_mm, fold, mask_path, shading_path, beauty_shot_xml_path)"
        )
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ).then((data) => ({ data })),
    supabase.from("templates").select("*").order("name", { ascending: true }),
    supabase.from("categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("visuals").select("*").order("name", { ascending: true }),
    supabase.from("product_collections").select("*").order("sort_order", { ascending: true }),
    // Juste de quoi savoir quels modèles ont au moins un mockup (voir
    // supabase/migrations/0049_template_mockups.sql) — le détail est
    // chargé à l'ouverture de la modale.
    supabase.from("template_mockups").select("template_id"),
  ]);

  const rows = (products as ProductWithTemplate[]) ?? [];

  // Adresses signées par lots (une requête par bucket, pas une par fichier).
  // TTL généreux : l'URL sert aussi à l'aperçu dans la modale d'édition,
  // ouverte potentiellement longtemps après le chargement de la page.
  const visualRows = (visuals as Visual[]) ?? [];
  const [uploadUrls, visualUrls] = await Promise.all([
    signedUrls(supabase, "uploads", rows.flatMap((p) => [p.image_path, p.back_image_path])),
    signedUrls(supabase, "visuals", visualRows.map((v) => v.file_path)),
  ]);
  const withUrls = rows.map((p) => ({
    ...p,
    imageUrl: uploadUrls.get(p.image_path) ?? null,
    backImageUrl: (p.back_image_path && uploadUrls.get(p.back_image_path)) || null,
  }));
  const visualsWithUrls: VisualWithUrl[] = visualRows.map((v) => ({ ...v, fileUrl: visualUrls.get(v.file_path) ?? null }));

  return (
    <ProductsTable
      products={withUrls}
      templates={(templates as Template[]) ?? []}
      categories={(categories as Category[]) ?? []}
      visuals={visualsWithUrls}
      collections={(productCollections as ProductCollection[]) ?? []}
      templateIdsWithMockups={Array.from(
        new Set(((mockupRows as { template_id: string }[]) ?? []).map((m) => m.template_id))
      )}
    />
  );
}

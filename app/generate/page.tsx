import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import UploadForm from "@/components/UploadForm";
import type { Category, Product } from "@/lib/types";

type ProductWithTemplate = Product & {
  template: {
    name: string;
    category_id: string;
    width_mm: number;
    height_mm: number;
    dpi: number;
    two_sided: boolean;
  } | null;
};

export default async function GeneratePage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("*, template:templates(name, category_id, width_mm, height_mm, dpi, two_sided)")
      .order("name", { ascending: true }),
    supabase.from("categories").select("*").order("sort_order", { ascending: true }),
  ]);

  const rows = (products as ProductWithTemplate[]) ?? [];

  const withUrls = await Promise.all(
    rows.map(async (p) => {
      const { data } = await supabase.storage.from("uploads").createSignedUrl(p.image_path, 60 * 10);
      return { ...p, imageUrl: data?.signedUrl ?? null };
    })
  );

  return (
    <div>
      <h1 className="mb-6 text-page-title font-semibold text-pico-black">
        Générer un PDF prêt pour impression
      </h1>
      <UploadForm products={withUrls} categories={(categories as Category[]) ?? []} />
    </div>
  );
}

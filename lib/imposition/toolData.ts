import { createServerSupabaseClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/selectAll";
import type { FormatOption, ProductOption } from "@/components/ImpositionTool";
import { templateLabel } from "@/lib/templateLabel";
import { productDisplayName } from "@/lib/imposition/productLabel";
import { BARCODE_DIR, jobNosFromStoredNames } from "@/lib/imposition/barcodes";
import type { Category, ImpositionCutter, ImpositionDuploJob, ImpositionSheet, Template, ImpositionProfile } from "@/lib/types";

interface ProductRow {
  id: string;
  name: string;
  template_id: string;
  rotated: boolean;
  image_path: string | null;
  visual_id: string | null;
}

// Données dont l'écran d'imposition a besoin (feuilles, jobs Duplo, profils Graphtec, formats, produits).
export async function loadImpositionToolData() {
  const supabase = createServerSupabaseClient();
  const [
    { data: sheets },
    { data: duploJobs },
    { data: cutters },
    { data: templates },
    { data: categories },
    { data: products },
    { data: visuals },
    { data: profiles },
  ] =
    await Promise.all([
      supabase
        .from("imposition_sheets")
        .select("*")
        .order("width_mm", { ascending: true })
        .order("height_mm", { ascending: true }),
      supabase.from("imposition_duplo_jobs").select("*").order("job_no", { ascending: true }),
      supabase
        .from("imposition_cutters")
        .select("*")
        .eq("machine", "graphtec")
        .order("name", { ascending: true }),
      supabase.from("templates").select("*").order("name", { ascending: true }),
      supabase.from("categories").select("*").order("sort_order", { ascending: true }),
      // Seuls les produits dont le PDF a déjà été généré peuvent être imposés.
      selectAll((from, to) =>
        supabase
          .from("products")
          .select("id, name, template_id, rotated, image_path, visual_id")
          .not("pdf_path", "is", null)
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ).then((data) => ({ data })),
      supabase.from("visuals").select("id, name"),
      // Profils d'imposition (voir 0078), appliqués et enregistrés depuis l'outil.
      supabase.from("imposition_profiles").select("*").order("name", { ascending: true }),
    ]);
  const visualNames = new Map(((visuals as { id: string; name: string }[]) ?? []).map((v) => [v.id, v.name]));

  // Numéros de job qui ont un code-barres importé (une page de 1 000 fichiers suffit : 250 jobs).
  const { data: barcodeFiles } = await supabase.storage.from("imposition").list(BARCODE_DIR, { limit: 1000 });
  const barcodeJobNos = jobNosFromStoredNames((barcodeFiles ?? []).map((f) => f.name));

  const templateRows = (templates as Template[]) ?? [];
  const pageSize = (t: Template, rotated: boolean) => {
    const w = t.width_mm + t.bleed_mm * 2;
    const h = t.height_mm + t.bleed_mm * 2;
    return rotated ? { widthMm: h, heightMm: w } : { widthMm: w, heightMm: h };
  };

  // Formats classés selon l'ordre des catégories (Papeterie en premier, voir
  // Modèles > Gérer les catégories), puis par nom : à nom égal, « Recto » passe
  // avant « Recto-verso ».
  const categoryRows = (categories as Category[]) ?? [];
  const categoryRank = new Map(categoryRows.map((c, i) => [c.id, i]));
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));
  const formats: FormatOption[] = templateRows
    .map((t) => ({
      id: t.id,
      name: templateLabel(t.name, t.two_sided),
      category: categoryName.get(t.category_id) ?? "Autres",
      bleedMm: t.bleed_mm,
      rank: categoryRank.get(t.category_id) ?? categoryRows.length,
      ...pageSize(t, false),
    }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "fr"))
    .map(({ rank: _rank, ...format }) => format);
  const templateById = new Map(templateRows.map((t) => [t.id, t]));
  const productOptions: ProductOption[] = ((products as ProductRow[]) ?? []).flatMap((p) => {
    const template = templateById.get(p.template_id);
    if (!template) return [];
    return [{ id: p.id, name: productDisplayName(p, visualNames), templateId: p.template_id, ...pageSize(template, p.rotated) }];
  });

  return {
    sheets: (sheets as ImpositionSheet[]) ?? [],
    duploJobs: (duploJobs as ImpositionDuploJob[]) ?? [],
    cutters: (cutters as ImpositionCutter[]) ?? [],
    barcodeJobNos,
    formats,
    products: productOptions,
    profiles: (profiles as ImpositionProfile[]) ?? [],
  };
}

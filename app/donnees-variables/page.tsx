import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import DataTemplatesList, { type DataTemplateListItem } from "@/components/variableData/DataTemplatesList";
import type { Category, Template } from "@/lib/types";

// Gabarits à données variables : des produits bâtis sur un modèle, dont
// certains contenus viennent d'un fichier (voir 0080_data_templates.sql).
export default async function DataTemplatesPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data: rows }, { data: templates }, { data: categories }] = await Promise.all([
    supabase.from("data_templates").select("id, name, template_id, two_sided, front_path, back_path, zones").order("name"),
    supabase.from("templates").select("*").order("name"),
    supabase.from("categories").select("*").order("sort_order"),
  ]);
  return (
    <DataTemplatesList
      items={(rows as DataTemplateListItem[]) ?? []}
      templates={(templates as Template[]) ?? []}
      categories={(categories as Category[]) ?? []}
    />
  );
}

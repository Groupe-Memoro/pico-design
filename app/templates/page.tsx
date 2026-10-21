import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import TemplatesTable, { type TemplateWithOverlayUrl } from "@/components/TemplatesTable";
import type { Category, Sku, Template } from "@/lib/types";
import { signedUrls } from "@/lib/storageUrls";

export default async function TemplatesPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data: templates }, { data: categories }, { data: skus }, { data: profiles }] = await Promise.all([
    supabase.from("templates").select("*").order("name", { ascending: true }),
    supabase.from("categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("skus").select("*").order("sku", { ascending: true }),
    // Profils d'imposition (voir 0078) : choisis dans la fiche du modèle.
    supabase.from("imposition_profiles").select("id, name").order("name", { ascending: true }),
  ]);

  const rows = (templates as Template[]) ?? [];


  // Plus de téléchargement/parsing du XML de chaque modèle ici : les
  // mockups se configurent dans leur propre écran (TemplateMockupsManager),
  // qui charge ce dont il a besoin à l'ouverture. Ça évitait un aller-retour
  // de stockage par modèle à chaque affichage de la liste.
  const urls = await signedUrls(supabase, "overlays", rows.map((t) => t.overlay_path));
  const withOverlayUrls: TemplateWithOverlayUrl[] = rows.map((t) => ({
    ...t,
    overlayUrl: (t.overlay_path && urls.get(t.overlay_path)) || null,
  }));

  return (
    <TemplatesTable
      templates={withOverlayUrls}
      categories={(categories as Category[]) ?? []}
      skus={(skus as Sku[]) ?? []}
      impositionProfiles={(profiles as { id: string; name: string }[]) ?? []}
    />
  );
}

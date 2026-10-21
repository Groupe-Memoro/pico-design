import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import TemplatesTable, { type TemplateWithOverlayUrl } from "@/components/TemplatesTable";
import type { Category, Sku, Template } from "@/lib/types";

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

  async function signedUrl(path: string | null) {
    if (!path) return null;
    const { data } = await supabase.storage.from("overlays").createSignedUrl(path, 60 * 30);
    return data?.signedUrl ?? null;
  }

  // Plus de téléchargement/parsing du XML de chaque modèle ici : les
  // mockups se configurent dans leur propre écran (TemplateMockupsManager),
  // qui charge ce dont il a besoin à l'ouverture. Ça évitait un aller-retour
  // de stockage par modèle à chaque affichage de la liste.
  const withOverlayUrls: TemplateWithOverlayUrl[] = await Promise.all(
    rows.map(async (t) => ({ ...t, overlayUrl: await signedUrl(t.overlay_path) }))
  );

  return (
    <TemplatesTable
      templates={withOverlayUrls}
      categories={(categories as Category[]) ?? []}
      skus={(skus as Sku[]) ?? []}
      impositionProfiles={(profiles as { id: string; name: string }[]) ?? []}
    />
  );
}

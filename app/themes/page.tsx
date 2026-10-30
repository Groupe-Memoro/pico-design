import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import ThemesTable from "@/components/ThemesTable";
import type { Template, Theme } from "@/lib/types";
import { signedUrls } from "@/lib/storageUrls";
import { themeParts } from "@/lib/themeParts";

export default async function ThemesPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data: themes }, { data: templates }] = await Promise.all([
    supabase.from("themes").select("*").order("name", { ascending: true }),
    supabase.from("templates").select("*").order("name", { ascending: true }),
  ]);

  const rows = (themes as Theme[]) ?? [];
  // Adresses signées en un lot (une requête, pas deux par thème).
  const urls = await signedUrls(
    supabase,
    "overlays",
    rows.flatMap((t) => themeParts(t).flatMap((p) => [p.overlay_path, p.background_path ?? null]))
  );
  const withOverlayUrls = rows.map((t) => ({
    ...t,
    overlayUrl: urls.get(t.overlay_path) ?? null,
    backgroundUrl: (t.background_path && urls.get(t.background_path)) || null,
    // Fichiers de chaque partie (recto/verso ou volets), pour l'éditeur.
    partUrls: Object.fromEntries(
      themeParts(t).map((p) => [
        p.key,
        { overlayUrl: urls.get(p.overlay_path) ?? null, backgroundUrl: (p.background_path && urls.get(p.background_path)) || null },
      ])
    ),
  }));

  return <ThemesTable themes={withOverlayUrls} templates={(templates as Template[]) ?? []} />;
}

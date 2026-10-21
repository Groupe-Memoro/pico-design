import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import VisualsGrid, { type VisualWithUrl } from "@/components/VisualsGrid";
import type { Visual, VisualCollection } from "@/lib/types";
import { signedUrls } from "@/lib/storageUrls";

export default async function VisualsPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const [{ data: visuals }, { data: collections }] = await Promise.all([
    supabase.from("visuals").select("*").order("name", { ascending: true }),
    supabase.from("visual_collections").select("*").order("sort_order", { ascending: true }),
  ]);

  const rows = (visuals as Visual[]) ?? [];

  // Adresses signées en un lot (une requête, pas une par visuel).
  const urls = await signedUrls(supabase, "visuals", rows.map((v) => v.file_path));
  const withUrls: VisualWithUrl[] = rows.map((v) => ({ ...v, fileUrl: urls.get(v.file_path) ?? null }));

  return <VisualsGrid visuals={withUrls} collections={(collections as VisualCollection[]) ?? []} />;
}

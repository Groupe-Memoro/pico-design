import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import AlbumsList, { type AlbumSummary } from "@/components/albums/AlbumsList";

// Module Albums des finissants : la liste des albums (voir
// supabase/migrations/0071_albums.sql).
export default async function AlbumsPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("albums")
    .select("id, name, school, year, updated_at, pdf_generated_at, album_students(count)")
    .order("updated_at", { ascending: false });

  const albums: AlbumSummary[] = ((data as (Omit<AlbumSummary, "students"> & { album_students: { count: number }[] })[]) ?? []).map(
    ({ album_students, ...a }) => ({ ...a, students: album_students?.[0]?.count ?? 0 })
  );
  return <AlbumsList albums={albums} />;
}

import { notFound } from "next/navigation";
import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import { albumStorage, loadAlbum, thumbPathOf } from "@/lib/albums/server";
import { pdfDownloadName } from "@/lib/imposition/saved";
import type { CoverContent, FreeContent } from "@/lib/albums/types";
import AlbumEditor from "@/components/albums/AlbumEditor";

// Une heure : le temps d'une séance de mise en page.
const SIGNED_URL_SECONDS = 60 * 60;

export default async function AlbumPage({ params }: { params: { id: string } }) {
  await requireUser();
  const loaded = await loadAlbum(createServerSupabaseClient(), params.id);
  if (!loaded) notFound();
  const { album, students, pages } = loaded;

  // Vignettes de toutes les photos (élèves, couverture, pages libres), en une
  // requête : l'aperçu les affiche à la place des versions d'impression.
  const photos = [
    ...students.map((s) => s.photo_path),
    ...pages.flatMap((p) =>
      p.kind === "cover" ? [(p.content as CoverContent).photo] : p.kind === "free" ? (p.content as FreeContent).photos : []
    ),
  ].filter((p): p is string => Boolean(p));
  const storage = albumStorage();
  const thumbs: Record<string, string> = {};
  if (photos.length > 0) {
    const { data } = await storage.createSignedUrls(photos.map(thumbPathOf), SIGNED_URL_SECONDS);
    (data ?? []).forEach((entry, i) => {
      if (entry.signedUrl) thumbs[photos[i]] = entry.signedUrl;
    });
  }
  const pdfUrl = album.pdf_path
    ? (await storage.createSignedUrl(album.pdf_path, SIGNED_URL_SECONDS, { download: pdfDownloadName(album.name) })).data?.signedUrl ?? null
    : null;

  return <AlbumEditor album={album} students={students} pages={pages} thumbs={thumbs} pdfUrl={pdfUrl} />;
}

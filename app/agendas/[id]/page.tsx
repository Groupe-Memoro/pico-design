import { notFound } from "next/navigation";
import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import { agendaStorage, loadAgenda, thumbPathOf } from "@/lib/agendas/server";
import { agendaPageFiles } from "@/lib/agendas/types";
import { pdfDownloadName } from "@/lib/imposition/saved";
import AgendaEditor from "@/components/agendas/AgendaEditor";

const SIGNED_URL_SECONDS = 60 * 60;

export default async function AgendaPage({ params }: { params: { id: string } }) {
  await requireUser();
  const loaded = await loadAgenda(createServerSupabaseClient(), params.id);
  if (!loaded) notFound();
  const { agenda, days, pages } = loaded;

  // Vignettes des photos (couverture, info, commanditaires, bandeaux), en une
  // requête ; les PDF fournis n'en ont pas.
  const photos = pages.flatMap((p) => agendaPageFiles(p.kind, p.content)).filter((p) => p.includes("/photos/"));
  const storage = agendaStorage();
  const thumbs: Record<string, string> = {};
  if (photos.length > 0) {
    const { data } = await storage.createSignedUrls(photos.map(thumbPathOf), SIGNED_URL_SECONDS);
    (data ?? []).forEach((entry, i) => {
      if (entry.signedUrl) thumbs[photos[i]] = entry.signedUrl;
    });
  }
  const pdfUrl = agenda.pdf_path
    ? (await storage.createSignedUrl(agenda.pdf_path, SIGNED_URL_SECONDS, { download: pdfDownloadName(agenda.name) })).data?.signedUrl ?? null
    : null;

  return <AgendaEditor agenda={agenda} days={days} pages={pages} thumbs={thumbs} pdfUrl={pdfUrl} />;
}

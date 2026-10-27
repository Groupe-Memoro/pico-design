"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UpdatingBadge from "@/components/UpdatingBadge";
import { ChevronLeftIcon, DownloadIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import AlbumPagesPanel from "@/components/albums/AlbumPagesPanel";
import AlbumStudentsPanel from "@/components/albums/AlbumStudentsPanel";
import AlbumSettingsForm from "@/components/albums/AlbumSettingsForm";
import { layoutAlbum } from "@/lib/albums/layout";
import type { Album, AlbumPage, AlbumStudent } from "@/lib/albums/types";

type Tab = "pages" | "students" | "settings";

// Éditeur d'un album : ses pages, ses finissants, ses réglages, et le PDF.
export default function AlbumEditor({
  album,
  students,
  pages,
  thumbs,
  pdfUrl,
}: {
  album: Album;
  students: AlbumStudent[];
  pages: AlbumPage[];
  thumbs: Record<string, string>;
  pdfUrl: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(students.length === 0 ? "students" : "pages");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geometry = useMemo(
    () => ({ widthMm: Number(album.width_mm), heightMm: Number(album.height_mm), bleedMm: Number(album.bleed_mm) }),
    [album.width_mm, album.height_mm, album.bleed_mm]
  );
  const pageCount = useMemo(() => layoutAlbum(geometry, album.settings, pages, students).length, [geometry, album.settings, pages, students]);
  // Le PDF ne suit pas les changements faits depuis sa génération.
  const pdfStale = Boolean(album.pdf_generated_at && new Date(album.updated_at) > new Date(album.pdf_generated_at));

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await fetch(`/api/albums/${album.id}/pdf`, { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setGenerating(false);
    if (!res?.ok) {
      setError(data.error ?? (res?.status === 504 ? "La génération a pris trop de temps." : "Erreur lors de la génération du PDF."));
      return;
    }
    if (data.url) window.location.href = data.url;
    refresh();
  }

  async function remove() {
    if (!confirm(`Supprimer l'album « ${album.name} », ses ${students.length} élèves et toutes ses photos ? C'est définitif.`)) return;
    const res = await fetch(`/api/albums/${album.id}`, { method: "DELETE" });
    if (res.ok) router.push("/albums");
    else alert((await res.json().catch(() => ({}))).error ?? "Suppression impossible.");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pages", label: `Pages (${pageCount})` },
    { id: "students", label: `Finissants (${students.length})` },
    { id: "settings", label: "Réglages" },
  ];

  return (
    <div>
      <Link href="/albums" className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-text">
        <ChevronLeftIcon className="h-4 w-4" /> Albums
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            {album.name}
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">{[album.school, album.year].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pdfUrl && !generating && (
            <a
              href={pdfUrl}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50 ${pdfStale ? "border-warning text-warning-strong" : "border-neutral-300"}`}
              title={pdfStale ? "L'album a changé depuis : générez à nouveau le PDF" : undefined}
            >
              <DownloadIcon className="h-4 w-4" />
              PDF du {new Date(album.pdf_generated_at!).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}
              {pdfStale && " (ancien)"}
            </a>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={generating || pageCount === 0}
            className="flex items-center gap-2 btn-primary disabled:opacity-60"
          >
            {generating && <SpinnerIcon className="h-4 w-4" />}
            {generating ? "Génération du PDF…" : "Générer le PDF"}
          </button>
          <button
            type="button"
            onClick={remove}
            title="Supprimer l'album"
            aria-label="Supprimer l'album"
            className="rounded-lg p-2 text-neutral-500 hover:bg-danger-subtle hover:text-danger"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {generating && (
        <p className="mb-3 text-sm text-neutral-600">
          Les photos sont recadrées à 300 dpi : comptez jusqu&apos;à une minute pour quelques centaines d&apos;élèves.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.id ? "border-pico-maroon font-medium text-text" : "border-transparent text-neutral-500 hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pages" && (
        <AlbumPagesPanel
          albumId={album.id}
          geometry={geometry}
          settings={album.settings}
          blocks={pages}
          students={students}
          thumbs={thumbs}
          onChanged={refresh}
        />
      )}
      {tab === "students" && <AlbumStudentsPanel albumId={album.id} students={students} thumbs={thumbs} onChanged={refresh} />}
      {tab === "settings" && <AlbumSettingsForm key={album.updated_at} album={album} onSaved={refresh} />}
    </div>
  );
}

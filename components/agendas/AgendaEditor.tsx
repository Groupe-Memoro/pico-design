"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UpdatingBadge from "@/components/UpdatingBadge";
import { ChevronLeftIcon, DownloadIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import AgendaPagesPanel from "@/components/agendas/AgendaPagesPanel";
import AgendaDaysEditor from "@/components/agendas/AgendaDaysEditor";
import AgendaSettingsForm from "@/components/agendas/AgendaSettingsForm";
import type { Agenda, AgendaDay, AgendaPage } from "@/lib/agendas/types";

type Tab = "pages" | "days" | "settings";

// Éditeur d'un agenda : ses pages, son calendrier scolaire, ses réglages, et le PDF.
export default function AgendaEditor({
  agenda,
  days,
  pages,
  thumbs,
  pdfUrl,
}: {
  agenda: Agenda;
  days: AgendaDay[];
  pages: AgendaPage[];
  thumbs: Record<string, string>;
  pdfUrl: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("pages");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geometry = useMemo(
    () => ({ widthMm: Number(agenda.width_mm), heightMm: Number(agenda.height_mm), bleedMm: Number(agenda.bleed_mm) }),
    [agenda.width_mm, agenda.height_mm, agenda.bleed_mm]
  );
  const pdfStale = Boolean(agenda.pdf_generated_at && new Date(agenda.updated_at) > new Date(agenda.pdf_generated_at));

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await fetch(`/api/agendas/${agenda.id}/pdf`, { method: "POST" }).catch(() => null);
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
    if (!confirm(`Supprimer l'agenda « ${agenda.name} », ses pages et tous ses fichiers ? C'est définitif.`)) return;
    const res = await fetch(`/api/agendas/${agenda.id}`, { method: "DELETE" });
    if (res.ok) router.push("/agendas");
    else alert((await res.json().catch(() => ({}))).error ?? "Suppression impossible.");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pages", label: "Pages" },
    { id: "days", label: `Calendrier scolaire (${days.length})` },
    { id: "settings", label: "Réglages" },
  ];

  return (
    <div>
      <Link href="/agendas" className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-text">
        <ChevronLeftIcon className="h-4 w-4" /> Agendas
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            {agenda.name}
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">{[agenda.school, agenda.year_label].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pdfUrl && !generating && (
            <a
              href={pdfUrl}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50 ${pdfStale ? "border-warning text-warning-strong" : "border-neutral-300"}`}
              title={pdfStale ? "L'agenda a changé depuis : générez à nouveau le PDF" : undefined}
            >
              <DownloadIcon className="h-4 w-4" />
              PDF du {new Date(agenda.pdf_generated_at!).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}
              {pdfStale && " (ancien)"}
            </a>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-2 btn-primary disabled:opacity-60"
          >
            {generating && <SpinnerIcon className="h-4 w-4" />}
            {generating ? "Génération du PDF…" : "Générer le PDF"}
          </button>
          <button type="button" onClick={remove} title="Supprimer l'agenda" aria-label="Supprimer l'agenda" className="rounded-lg p-2 text-neutral-500 hover:bg-danger-subtle hover:text-danger">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
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

      {tab === "pages" && <AgendaPagesPanel agenda={agenda} geometry={geometry} blocks={pages} days={days} thumbs={thumbs} onChanged={refresh} />}
      {tab === "days" && <AgendaDaysEditor agenda={agenda} days={days} onChanged={refresh} />}
      {tab === "settings" && <AgendaSettingsForm key={agenda.updated_at} agenda={agenda} onSaved={refresh} />}
    </div>
  );
}

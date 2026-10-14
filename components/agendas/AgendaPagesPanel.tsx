"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { ChevronDownIcon, ChevronUpIcon, FilePenIcon, TrashIcon } from "@/components/icons";
import PagePreview from "@/components/print/PagePreview";
import AgendaBlockForm from "@/components/agendas/AgendaBlockForm";
import { layoutAgenda } from "@/lib/agendas/layout";
import type { PrintGeometry } from "@/lib/print/elements";
import {
  AGENDA_PAGE_LABELS,
  CALENDAR_LAYOUTS,
  defaultAgendaContent,
  type Agenda,
  type AgendaDay,
  type AgendaPage,
  type AgendaPageKind,
  type CalendarContent,
  type CoverContent,
  type InfoContent,
  type NotesContent,
  type PdfContent,
  type SponsorsContent,
} from "@/lib/agendas/types";

// Aperçus montrés par bloc : un calendrier d'une année en fait des centaines.
const MAX_THUMBS = 12;

function summary(block: AgendaPage, agenda: Agenda): string {
  const c = block.content;
  switch (block.kind) {
    case "cover":
      return (c as CoverContent).title || "Sans titre";
    case "calendar": {
      const k = c as CalendarContent;
      const layout = CALENDAR_LAYOUTS.find((l) => l.id === k.layout)?.label ?? "";
      return `${layout} · du ${k.from || agenda.start_date} au ${k.to || agenda.end_date}${k.banners.length ? ` · ${k.banners.length} bandeau(x)` : ""}`;
    }
    case "info":
      return (c as InfoContent).title || "Sans titre";
    case "pdf":
      return (c as PdfContent).path ? `${(c as PdfContent).name} (${(c as PdfContent).pageCount} p.)` : "Aucun PDF choisi";
    case "sponsors":
      return `${(c as SponsorsContent).photos.length} publicité(s)`;
    case "notes":
      return `${(c as NotesContent).count} page(s)`;
  }
}

export default function AgendaPagesPanel({
  agenda,
  geometry,
  blocks,
  days,
  thumbs,
  onChanged,
}: {
  agenda: Agenda;
  geometry: PrintGeometry;
  blocks: AgendaPage[];
  days: AgendaDay[];
  thumbs: Record<string, string>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AgendaPage | null>(null);
  const [busy, setBusy] = useState(false);
  const pages = useMemo(() => layoutAgenda(geometry, agenda, agenda.settings, blocks, days), [geometry, agenda, blocks, days]);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    setBusy(false);
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "L'opération a échoué.");
    onChanged();
    return res;
  }

  async function add(kind: AgendaPageKind) {
    const res = await call(`/api/agendas/${agenda.id}/pages`, { method: "POST", body: JSON.stringify({ kind }) });
    if (res.ok) {
      const { id } = await res.json();
      setEditing({ id, agenda_id: agenda.id, kind, position: blocks.length, content: defaultAgendaContent(kind) });
    }
  }

  function move(index: number, delta: number) {
    const order = blocks.map((b) => b.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    call(`/api/agendas/${agenda.id}/pages`, { method: "PUT", body: JSON.stringify({ order }) });
  }

  function remove(block: AgendaPage) {
    if (!confirm(`Supprimer le bloc « ${AGENDA_PAGE_LABELS[block.kind]} — ${summary(block, agenda)} » ?`)) return;
    call(`/api/agendas/${agenda.id}/pages/${block.id}`, { method: "DELETE" });
  }

  const total = pages.length;
  const toFour = Math.ceil(total / 4) * 4 - total;

  return (
    <div className={busy ? "pointer-events-none opacity-60" : ""}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {total} page{total > 1 ? "s" : ""}
          {toFour > 0 && <span className="text-amber-700"> · multiple de 4 pour la reliure : ajoutez {toFour} page{toFour > 1 ? "s" : ""} (Notes)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {(["calendar", "info", "pdf", "sponsors", "notes", "cover"] as AgendaPageKind[]).map((kind) => (
            <button key={kind} type="button" onClick={() => add(kind)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              + {AGENDA_PAGE_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((block, index) => {
          const own = pages.map((page, i) => ({ page, i })).filter((p) => p.page.blockId === block.id);
          return (
            <div key={block.id} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{AGENDA_PAGE_LABELS[block.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-pico-black">{summary(block, agenda)}</span>
                <span className="text-xs text-neutral-500">
                  {own.length ? `p. ${own[0].i + 1}${own.length > 1 ? `–${own[own.length - 1].i + 1}` : ""}` : "aucune page"}
                </span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Monter" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === blocks.length - 1} aria-label="Descendre" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setEditing(block)} aria-label="Modifier" title="Modifier" className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-pico-black">
                  <FilePenIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(block)} aria-label="Supprimer" title="Supprimer" className="rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-600">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {own.slice(0, MAX_THUMBS).map(({ page, i }) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditing(block)}
                    className="w-24 shrink-0 overflow-hidden rounded border border-neutral-200 shadow-sm hover:border-neutral-400"
                    title={`Page ${i + 1} (${i % 2 === 1 ? "gauche" : "droite"})`}
                  >
                    <PagePreview page={page} geometry={geometry} thumbs={thumbs} />
                  </button>
                ))}
                {own.length > MAX_THUMBS && <span className="shrink-0 px-2 text-xs text-neutral-500">+ {own.length - MAX_THUMBS} pages</span>}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal title={`${AGENDA_PAGE_LABELS[editing.kind]} — modifier`} onClose={() => setEditing(null)} full>
          <AgendaBlockForm
            agenda={agenda}
            block={editing}
            blocks={blocks.some((b) => b.id === editing.id) ? blocks : [...blocks, editing]}
            days={days}
            geometry={geometry}
            thumbs={thumbs}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

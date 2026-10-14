"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { SpinnerIcon } from "@/components/icons";
import { AGENDA_FORMATS } from "@/lib/agendas/types";

export interface AgendaSummary {
  id: string;
  name: string;
  school: string;
  year_label: string;
  start_date: string;
  end_date: string;
  updated_at: string;
  pdf_generated_at: string | null;
}

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

// Prochaine année scolaire : de fin août à fin juin.
function defaultYear() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return { start: `${y}-08-27`, end: `${y + 1}-06-22`, label: `${y}-${y + 1}` };
}

function CreateAgendaForm({ onCreated }: { onCreated: (id: string) => void }) {
  const d = defaultYear();
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [yearLabel, setYearLabel] = useState(d.label);
  const [start, setStart] = useState(d.start);
  const [end, setEnd] = useState(d.end);
  const [formatId, setFormatId] = useState(AGENDA_FORMATS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/agendas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, school, year_label: yearLabel, start_date: start, end_date: end, formatId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Création impossible.");
      return;
    }
    onCreated(data.id);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Nom de l&apos;agenda</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Agenda 2026-2027 — École Pico" className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium">École</label>
          <input value={school} onChange={(e) => setSchool(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium">Année</label>
          <input value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Premier jour</label>
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium">Dernier jour</label>
          <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Format</label>
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)} className={inputClass}>
          {AGENDA_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">Les fériés du Québec sont marqués d&apos;office ; le reste se règle ensuite.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Créer l&apos;agenda
        </button>
      </div>
    </form>
  );
}

export default function AgendasList({ agendas }: { agendas: AgendaSummary[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-pico-black">Agendas scolaires</h1>
          <p className="text-sm text-neutral-500">Calendrier de l&apos;école, pages au choix, commanditaires, PDF d&apos;impression.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark"
        >
          Nouvel agenda
        </button>
      </div>

      {agendas.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          Aucun agenda pour l&apos;instant. Créez-en un pour une école et une année scolaire.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agendas.map((a) => (
            <Link
              key={a.id}
              href={`/agendas/${a.id}`}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow"
            >
              <p className="font-medium text-pico-black">{a.name}</p>
              <p className="text-sm text-neutral-500">{[a.school, a.year_label].filter(Boolean).join(" · ") || "—"}</p>
              <p className="mt-3 text-xs text-neutral-500">
                Du {a.start_date} au {a.end_date} ·{" "}
                {a.pdf_generated_at ? `PDF du ${new Date(a.pdf_generated_at).toLocaleDateString("fr-CA")}` : "PDF pas encore généré"}
              </p>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="Nouvel agenda" onClose={() => setCreating(false)}>
          <CreateAgendaForm onCreated={(id) => router.push(`/agendas/${id}`)} />
        </Modal>
      )}
    </div>
  );
}

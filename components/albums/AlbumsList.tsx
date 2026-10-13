"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { SpinnerIcon } from "@/components/icons";
import { ALBUM_FORMATS } from "@/lib/albums/types";

export interface AlbumSummary {
  id: string;
  name: string;
  school: string;
  year: string;
  updated_at: string;
  pdf_generated_at: string | null;
  students: number;
}

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

function CreateAlbumForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [formatId, setFormatId] = useState(ALBUM_FORMATS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, school, year, formatId }),
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
        <label className="block text-sm font-medium">Nom de l&apos;album</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Finissants 2026 — École Pico" className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium">École</label>
          <input value={school} onChange={(e) => setSchool(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium">Année</label>
          <input value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Format</label>
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)} className={inputClass}>
          {ALBUM_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">Fond perdu de 1/8 po. Modifiable ensuite dans Réglages.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Créer l&apos;album
        </button>
      </div>
    </form>
  );
}

// Liste des albums : un clic ouvre l'éditeur.
export default function AlbumsList({ albums }: { albums: AlbumSummary[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-pico-black">Albums des finissants</h1>
          <p className="text-sm text-neutral-500">
            Liste des élèves et photos, pages de portraits automatiques, PDF d&apos;impression.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-pico-maroon px-4 py-2 text-sm font-medium text-white hover:bg-pico-maroon-dark"
        >
          Nouvel album
        </button>
      </div>

      {albums.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          Aucun album pour l&apos;instant. Créez-en un pour importer la liste des finissants et leurs photos.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              href={`/albums/${a.id}`}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow"
            >
              <p className="font-medium text-pico-black">{a.name}</p>
              <p className="text-sm text-neutral-500">{[a.school, a.year].filter(Boolean).join(" · ") || "—"}</p>
              <p className="mt-3 text-xs text-neutral-500">
                {a.students} finissant{a.students > 1 ? "s" : ""} ·{" "}
                {a.pdf_generated_at ? `PDF du ${new Date(a.pdf_generated_at).toLocaleDateString("fr-CA")}` : "PDF pas encore généré"}
              </p>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="Nouvel album" onClose={() => setCreating(false)}>
          <CreateAlbumForm onCreated={(id) => router.push(`/albums/${id}`)} />
        </Modal>
      )}
    </div>
  );
}

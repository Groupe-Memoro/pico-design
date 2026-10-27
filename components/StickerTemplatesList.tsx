"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import MeasureField, { UnitToggle, type Unit } from "@/components/MeasureField";
import UpdatingBadge from "@/components/UpdatingBadge";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { sheetLabel } from "@/lib/imposition/presets";
import type { StickerTemplate } from "@/lib/stickers/types";
import type { ImpositionSheet } from "@/lib/types";

// Nouveau modèle : un nom et la taille de la feuille (une feuille connue de
// l'imposition, ou une taille libre). Le reste se règle dans l'éditeur.
function NewTemplateForm({ sheets, onCancel }: { sheets: ImpositionSheet[]; onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [width, setWidth] = useState(sheets[0]?.width_mm ?? 215.9);
  const [height, setHeight] = useState(sheets[0]?.height_mm ?? 279.4);
  const [unit, setUnit] = useState<Unit>("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, width_mm: width, height_mm: height }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(data.error ?? "La création a échoué.");
      return;
    }
    router.push(`/autocollants/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Nom du modèle</label>
        <input
          autoFocus
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex. Étiquettes école — Dinosaures"
          className="mt-1 w-full input"
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500">Taille de la planche</span>
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
        {sheets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sheets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setWidth(s.width_mm);
                  setHeight(s.height_mm);
                }}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  Math.abs(s.width_mm - width) < 0.01 && Math.abs(s.height_mm - height) < 0.01
                    ? "border-pico-maroon bg-pico-maroon text-white"
                    : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {sheetLabel(s.width_mm, s.height_mm)}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <MeasureField key={`w-${unit}-${width}`} label="Largeur" valueMm={width} unit={unit} onChange={setWidth} />
          <MeasureField key={`h-${unit}-${height}`} label="Hauteur" valueMm={height} unit={unit} onChange={setHeight} />
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 btn-primary disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Créer et ouvrir le modèle
        </button>
      </div>
    </form>
  );
}

// Module Autocollants : la liste des modèles de planches.
export default function StickerTemplatesList({
  templates,
  sheets,
}: {
  templates: StickerTemplate[];
  sheets: ImpositionSheet[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function remove(t: StickerTemplate) {
    if (!confirm(`Supprimer le modèle « ${t.name} » et ses fichiers ?`)) return;
    setDeletingId(t.id);
    const res = await fetch(`/api/stickers/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeletingId(null);
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Autocollants
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            Modèles de planches d&apos;étiquettes : on écrit un nom, la planche se prépare, prête pour la Graphtec.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 btn-primary"
        >
          Nouveau modèle
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">
          Aucun modèle pour l&apos;instant. Créez-en un, ajoutez le visuel de la planche, les codes Graphtec et le
          gabarit de guidage, puis dessinez les zones du nom.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 card">
          {templates.map((t) => {
            const missing = [!t.artwork_path && "visuel", !t.marks_path && "codes Graphtec", t.zones.length === 0 && "zones"]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={t.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${deletingId === t.id ? "opacity-40" : ""}`}
              >
                <Link href={`/autocollants/${t.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text hover:underline">{t.name}</p>
                  <p className="text-xs text-neutral-500">
                    {sheetLabel(t.width_mm, t.height_mm)} · {t.zones.length} zone{t.zones.length > 1 ? "s" : ""} de nom
                    {missing && <span className="text-warning-strong"> · à compléter : {missing}</span>}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/autocollants/${t.id}`}
                    title="Ouvrir"
                    aria-label="Ouvrir"
                    className="icon-btn"
                  >
                    <FilePenIcon className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    disabled={deletingId === t.id}
                    title="Supprimer"
                    aria-label="Supprimer"
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
                  >
                    {deletingId === t.id ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <Modal title="Nouveau modèle d'autocollants" onClose={() => setCreating(false)}>
          <NewTemplateForm sheets={sheets} onCancel={() => setCreating(false)} />
        </Modal>
      )}
    </div>
  );
}

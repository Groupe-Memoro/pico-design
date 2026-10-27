"use client";

import { useState } from "react";
import MeasureField, { UnitToggle, type Unit } from "@/components/MeasureField";
import { SpinnerIcon, TrashIcon, FilePenIcon } from "@/components/icons";
import { sheetLabel } from "@/lib/imposition/presets";
import type { ImpositionSheet } from "@/lib/types";

const inputClass = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";

function mmLabel(mm: number): string {
  return `${Math.round(mm * 100) / 100} mm`;
}

export function RowActions({ onEdit, onDelete, busy }: { onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        aria-label="Modifier"
        className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-text"
      >
        <FilePenIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Supprimer"
        className="rounded-lg p-1.5 text-neutral-400 hover:bg-danger-subtle hover:text-danger disabled:opacity-40"
      >
        {busy ? <SpinnerIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 btn-primary disabled:opacity-50"
    >
      {loading && <SpinnerIcon className="h-4 w-4" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Feuilles

function SheetForm({
  sheet,
  onSuccess,
  onCancel,
}: {
  sheet?: ImpositionSheet;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [width, setWidth] = useState(sheet?.width_mm ?? 304.8);
  const [height, setHeight] = useState(sheet?.height_mm ?? 457.2);
  const [unit, setUnit] = useState<Unit>("in");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(sheet ? `/api/imposition/sheets/${sheet.id}` : "/api/imposition/sheets", {
      method: sheet ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width_mm: width, height_mm: height }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'enregistrement.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Dimensions</span>
        <UnitToggle unit={unit} onChange={setUnit} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MeasureField key={`w-${unit}`} label="Largeur" valueMm={width} unit={unit} onChange={setWidth} />
        <MeasureField key={`h-${unit}`} label="Hauteur" valueMm={height} unit={unit} onChange={setHeight} />
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
        <SubmitButton loading={loading}>{sheet ? "Enregistrer" : "Créer la feuille"}</SubmitButton>
      </div>
    </form>
  );
}

export function SheetsManager({
  sheets,
  onChanged,
}: {
  sheets: ImpositionSheet[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ImpositionSheet | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(sheet: ImpositionSheet) {
    if (!confirm(`Supprimer la feuille ${sheetLabel(sheet.width_mm, sheet.height_mm)} ?`)) return;
    setDeletingId(sheet.id);
    const res = await fetch(`/api/imposition/sheets/${sheet.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "La suppression a échoué.");
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <SheetForm
        sheet={editing === "new" ? undefined : editing}
        onCancel={() => setEditing(null)}
        onSuccess={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {sheets.length === 0 && <p className="text-sm text-neutral-500">Aucune feuille pour l&apos;instant.</p>}
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {sheets.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{sheetLabel(s.width_mm, s.height_mm)}</p>
              <p className="text-xs text-neutral-500">
                {mmLabel(s.width_mm)} × {mmLabel(s.height_mm)}
              </p>
            </div>
            <RowActions onEdit={() => setEditing(s)} onDelete={() => handleDelete(s)} busy={deletingId === s.id} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setEditing("new")}
        className="w-full btn-secondary border-dashed"
      >
        + Nouvelle feuille
      </button>
    </div>
  );
}

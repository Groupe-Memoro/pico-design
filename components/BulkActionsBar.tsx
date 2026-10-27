"use client";

import { SpinnerIcon } from "@/components/icons";

export default function BulkActionsBar({
  count,
  label,
  deleting,
  onDelete,
  onClear,
  children,
}: {
  count: number;
  label: string;
  deleting: boolean;
  onDelete: () => void;
  onClear: () => void;
  // Actions propres à la page, avant « Supprimer ».
  children?: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-pico-maroon/30 bg-primary-subtle px-4 py-2 text-sm">
      <span className="text-text">
        {count} {label}
        {count > 1 ? "s" : ""} sélectionné{count > 1 ? "s" : ""}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-neutral-300 bg-surface px-3 py-1.5 text-neutral-600 hover:bg-neutral-50"
        >
          Annuler
        </button>
        {children}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center gap-2 rounded-lg bg-danger px-3 py-1.5 text-white hover:bg-danger-hover disabled:opacity-50"
        >
          {deleting && <SpinnerIcon className="h-4 w-4" />}
          Supprimer
        </button>
      </div>
    </div>
  );
}

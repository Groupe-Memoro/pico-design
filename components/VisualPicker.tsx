"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import type { VisualWithUrl } from "@/components/VisualsGrid";

/**
 * Sélecteur de visuel avec miniatures — un <select> HTML ne peut pas
 * afficher d'image dans ses options, donc on ouvre plutôt une grille de
 * vignettes cliquables dans une modale, avec recherche par nom.
 */
export default function VisualPicker({
  visuals,
  value,
  onChange,
}: {
  visuals: VisualWithUrl[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = visuals.find((v) => v.id === value) ?? null;
  const filtered = visuals.filter((v) => v.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center gap-3 rounded border border-neutral-300 px-3 py-2 text-left hover:bg-neutral-50"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-100">
          {selected?.fileUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.fileUrl} alt="" className="h-full w-full object-contain" />
          ) : null}
        </div>
        <span className="flex-1 truncate text-sm text-text">
          {selected?.name ?? "Choisir un visuel..."}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className="h-4 w-4 shrink-0 text-neutral-400"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-5 4 5M8 15l4 5 4-5" />
        </svg>
      </button>

      {open && (
        <Modal title="Choisir un visuel" onClose={() => setOpen(false)} wide>
          <div className="space-y-3">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (nom)..."
              className="w-full input"
            />
            {filtered.length === 0 ? (
              <p className="text-sm text-neutral-500">Aucun visuel ne correspond.</p>
            ) : (
              <div className="grid max-h-[70vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
                {filtered.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onChange(v.id);
                      setOpen(false);
                    }}
                    className={`overflow-hidden rounded-lg border text-left ${
                      v.id === value
                        ? "border-pico-black ring-2 ring-pico-black"
                        : "border-neutral-200 hover:border-neutral-400"
                    }`}
                  >
                    <div className="flex h-28 items-center justify-center bg-neutral-50 p-2">
                      {v.fileUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/visuals/${v.id}/thumbnail?v=${encodeURIComponent(v.file_path)}`} alt={v.name} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="h-full w-full rounded bg-neutral-100" />
                      )}
                    </div>
                    <div className="truncate px-2 py-1.5 text-xs text-text">{v.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

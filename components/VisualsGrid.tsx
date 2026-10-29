"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import VisualForm from "@/components/VisualForm";
import CollectionsManager from "@/components/CollectionsManager";
import Modal from "@/components/Modal";
import BulkActionsBar from "@/components/BulkActionsBar";
import UpdatingBadge from "@/components/UpdatingBadge";
import { useSelection } from "@/components/useSelection";
import { FilePenIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { Visual, VisualCollection } from "@/lib/types";

export type VisualWithUrl = Visual & { fileUrl: string | null };

type ModalState =
  | { mode: "create" }
  | { mode: "edit"; visual: VisualWithUrl }
  | { mode: "collections" }
  | null;

export default function VisualsGrid({
  visuals,
  collections,
}: {
  visuals: VisualWithUrl[];
  collections: VisualCollection[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const collectionName = useMemo(() => {
    const map = new Map(collections.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [collections]);

  const filtered = useMemo(
    () =>
      visuals
        .filter((v) => (collectionId ? v.collection_id === collectionId : true))
        .filter((v) => v.name.toLowerCase().includes(search.trim().toLowerCase())),
    [visuals, search, collectionId]
  );

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleDelete(visual: VisualWithUrl) {
    if (!confirm(`Supprimer le visuel « ${visual.name} » ?`)) return;
    setDeletingId(visual.id);
    const res = await fetch(`/api/visuals/${visual.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    refresh();
  }

  async function handleBulkDelete() {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} visuel(s) ?`)) return;
    setBulkDeleting(true);
    const results = await Promise.all(ids.map((id) => fetch(`/api/visuals/${id}`, { method: "DELETE" })));
    setBulkDeleting(false);
    selection.clear();
    refresh();
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) alert(`${failed} suppression(s) ont échoué.`);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Banque de visuels
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {visuals.length} visuel{visuals.length > 1 ? "s" : ""} disponible
            {visuals.length > 1 ? "s" : ""}.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouveau visuel
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom)..."
            className="w-full rounded-lg border border-neutral-300 bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Collection</label>
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className="mt-1 input"
            >
              <option value="">— Toutes —</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setModal({ mode: "collections" })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Gérer les collections
          </button>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={() => selection.toggleAll(filtered.map((v) => v.id))}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              {filtered.every((v) => selection.selected.has(v.id)) ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          )}
        </div>
      </div>

      <BulkActionsBar
        count={selection.selected.size}
        label="visuel"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
      />

      {filtered.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          Aucun visuel ne correspond.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((v) => (
            <div
              key={v.id}
              className={`overflow-hidden rounded-xl border bg-surface shadow-sm transition-opacity duration-300 ${
                selection.selected.has(v.id) ? "border-pico-maroon" : "border-neutral-200"
              } ${deletingId === v.id ? "opacity-40" : ""}`}
            >
              <div className="relative flex h-32 items-center justify-center bg-neutral-50 p-3">
                <input
                  type="checkbox"
                  checked={selection.selected.has(v.id)}
                  onChange={() => selection.toggle(v.id)}
                  className="absolute left-2 top-2 h-4 w-4"
                />
                {v.fileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/visuals/${v.id}/thumbnail?v=${encodeURIComponent(v.file_path)}`} alt={v.name} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
                ) : (
                  <div className="h-full w-full rounded bg-neutral-100" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-text">{v.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setModal({ mode: "edit", visual: v })}
                      title="Modifier"
                      aria-label="Modifier"
                      className="icon-btn"
                    >
                      <FilePenIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(v)}
                      disabled={deletingId === v.id}
                      title="Supprimer"
                      aria-label="Supprimer"
                      className="inline-flex rounded-lg p-1.5 text-neutral-500 hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
                    >
                      {deletingId === v.id ? (
                        <SpinnerIcon className="h-4 w-4" />
                      ) : (
                        <TrashIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                {collectionName(v.collection_id) && (
                  <span className="mt-1 inline-block truncate text-xs text-neutral-500">
                    {collectionName(v.collection_id)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.mode === "collections" && (
        <Modal title="Gérer les collections" onClose={() => setModal(null)}>
          <CollectionsManager
            items={collections}
            apiBasePath="/api/visual-collections"
            deleteWarning="Son contenu ne sera pas supprimé."
            onChanged={() => refresh()}
          />
        </Modal>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={modal.mode === "create" ? "Nouveau visuel" : `Modifier « ${modal.visual.name} »`}
          onClose={() => setModal(null)}
        >
          <VisualForm
            visual={modal.mode === "edit" ? modal.visual : undefined}
            currentFileUrl={modal.mode === "edit" ? modal.visual.fileUrl : null}
            collections={collections}
            onSuccess={handleSuccess}
          />
        </Modal>
      )}
    </div>
  );
}
